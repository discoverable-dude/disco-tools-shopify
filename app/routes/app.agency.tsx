import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useNavigation } from "react-router";
import crypto from "node:crypto";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, apiVersion } from "../shopify.server";
import db from "../db.server";
import { platformHealth } from "../platform.server";
import { retryPending } from "../outbox.server";
import { startSync, type Resource } from "../sync.server";
import { missingScopes } from "../scopes.server";
import { fmt, tone } from "../ui";

const RESOURCES: Resource[] = ["products", "orders", "customers"];

// Embedded apps can't rely on cookies (Safari blocks them in iframes), so the
// passcode is checked on every request instead of keeping a session.
function passcodeOk(given: string) {
  const expected = process.env.AGENCY_PASSCODE || "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { configured: Boolean(process.env.AGENCY_PASSCODE) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const passcode = String(form.get("passcode") || "");
  if (!passcodeOk(passcode)) return { unlocked: false as const, error: "Incorrect passcode" };

  const intent = form.get("intent");
  if (intent === "link") {
    const clientSlug = String(form.get("clientSlug") || "").trim();
    const platformClientId = String(form.get("platformClientId") || "").trim();
    const on = Boolean(clientSlug || platformClientId);
    await db.shopLink.update({
      where: { shop },
      data: {
        clientSlug: clientSlug || null,
        platformClientId: platformClientId || null,
        status: on ? "linked" : "installed",
        linkedAt: on ? new Date() : null,
      },
    });
  } else if (intent === "sync") {
    const resource = String(form.get("resource")) as Resource;
    if (RESOURCES.includes(resource)) await startSync(admin, shop, resource);
  } else if (intent === "retry") {
    await retryPending();
  }

  const [link, health, events24h, pending, failed, lastEvent, runs, pushes] = await Promise.all([
    db.shopLink.findUnique({ where: { shop } }),
    platformHealth(),
    db.webhookEvent.count({ where: { shop, receivedAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    db.webhookEvent.count({ where: { shop, status: "pending" } }),
    db.webhookEvent.count({ where: { shop, status: "failed" } }),
    db.webhookEvent.findFirst({ where: { shop }, orderBy: { receivedAt: "desc" } }),
    db.syncRun.findMany({ where: { shop }, orderBy: { startedAt: "desc" }, take: 8 }),
    db.pushAudit.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const scopes = (session.scope ?? "").split(",").filter(Boolean);
  const platformUrl = process.env.DISCO_TOOLS_APP_URL?.replace(/\/$/, "");

  const checklist = [
    { label: "App installed", done: link?.status !== "uninstalled" },
    { label: "Linked to a Discoverable client", done: link?.status === "linked" },
    { label: "Discoverable Tools reachable", done: health.ok },
    { label: "Permissions complete", done: missingScopes(scopes).length === 0 },
    { label: "First data sync completed", done: Boolean(link?.lastSyncAt) },
    { label: "Webhooks flowing", done: events24h > 0 },
  ];

  return {
    unlocked: true as const,
    shop,
    link,
    health,
    scopes,
    apiVersion,
    checklist,
    webhooks: { events24h, pending, failed, last: lastEvent?.receivedAt ?? null },
    runs,
    pushes,
    openUrl: platformUrl && link?.platformClientId ? `${platformUrl}/clients/${link.platformClientId}` : null,
  };
};

export default function Agency() {
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const [passcode, setPasscode] = useState("");
  const d = result && result.unlocked ? result : null;

  const hidden = (intent: string) => (
    <>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="passcode" value={passcode} />
    </>
  );

  if (!d) {
    return (
      <s-page heading="Agency tools">
        <s-section heading="Discoverable staff only">
          <Form method="post">
            <input type="hidden" name="intent" value="unlock" />
            <s-stack gap="base">
              {result && !result.unlocked && <s-banner tone="critical">{result.error}</s-banner>}
              <s-password-field label="Passcode" name="passcode" onInput={(e: Event) => setPasscode((e.target as HTMLInputElement).value)} />
              <s-button type="submit" variant="primary">Unlock</s-button>
            </s-stack>
          </Form>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Agency tools">
      <s-section heading="Setup checklist">
        <s-stack gap="small">
          {d.checklist.map((c) => (
            <s-stack direction="inline" gap="small" key={c.label}>
              <s-badge tone={c.done ? "success" : "caution"}>{c.done ? "done" : "todo"}</s-badge>
              <s-text>{c.label}</s-text>
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Connection">
        <s-stack gap="small">
          <s-stack direction="inline" gap="small">
            <s-text>Discoverable Tools:</s-text>
            <s-badge tone={d.health.ok ? "success" : "critical"}>{d.health.detail}</s-badge>
          </s-stack>
          <s-text>Store: {d.shop} · API {d.apiVersion} · installed {fmt(d.link?.installedAt)}</s-text>
          <s-text>Granted scopes: {d.scopes.join(", ") || "none"}</s-text>
          {d.openUrl && <s-link href={d.openUrl} target="_blank">Open this client in Discoverable Tools</s-link>}
        </s-stack>
      </s-section>

      <s-section heading="Link to a Discoverable client">
        <Form method="post">
          {hidden("link")}
          <s-stack gap="base">
            <s-text-field label="Client slug" name="clientSlug" defaultValue={d.link?.clientSlug ?? ""} />
            <s-text-field label="Platform client ID" name="platformClientId" defaultValue={d.link?.platformClientId ?? ""} />
            <s-button type="submit" variant="primary" {...(busy ? { loading: true } : {})}>Save link</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Data sync">
        <s-stack gap="base">
          <s-text>Last sync: {fmt(d.link?.lastSyncAt)} {d.link?.lastSyncStatus ? `(${d.link.lastSyncStatus})` : ""}</s-text>
          <s-stack direction="inline" gap="small">
            {RESOURCES.map((r) => (
              <Form method="post" key={r}>
                {hidden("sync")}
                <input type="hidden" name="resource" value={r} />
                <s-button type="submit" {...(busy ? { disabled: true } : {})}>Sync {r}</s-button>
              </Form>
            ))}
          </s-stack>
          {d.runs.map((r) => (
            <s-stack direction="inline" gap="small" key={r.id}>
              <s-badge tone={tone(r.status)}>{r.status}</s-badge>
              <s-text>{r.resource} · {r.recordCount} records · {fmt(r.startedAt)}{r.error ? ` · ${r.error}` : ""}</s-text>
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Webhook delivery">
        <s-stack gap="base">
          <s-text>{d.webhooks.events24h} events in 24h · {d.webhooks.pending} pending · {d.webhooks.failed} failed · last {fmt(d.webhooks.last)}</s-text>
          <Form method="post">
            {hidden("retry")}
            <s-button type="submit">Retry pending</s-button>
          </Form>
        </s-stack>
      </s-section>

      <s-section heading="Recent pushes from Discoverable Tools">
        <s-stack gap="small">
          {d.pushes.length === 0 && <s-text>No changes pushed yet.</s-text>}
          {d.pushes.map((p) => (
            <s-stack direction="inline" gap="small" key={p.id}>
              <s-badge tone={tone(p.status)}>{p.status}</s-badge>
              <s-text>{p.resource} {p.resourceId.split("/").pop()} · {fmt(p.createdAt)}{p.error ? ` · ${p.error}` : ""}</s-text>
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
