import { useState, type CSSProperties } from "react";
import type { ActionFunctionArgs } from "react-router";
import { Form, useActionData } from "react-router";
import crypto from "node:crypto";
import { deleteCredential, listCredentials, saveCredential } from "../appcreds.server";
import { brand } from "../brand";

/**
 * Standalone (not embedded in Shopify) page for registering each client's Shopify app keys.
 * Guarded by AGENCY_PASSCODE, which is re-checked on every submit (no cookies needed).
 */
function passcodeOk(given: string) {
  const expected = process.env.AGENCY_PASSCODE || "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  if (!passcodeOk(String(form.get("passcode") || ""))) {
    return { unlocked: false as const, error: "Incorrect passcode", notice: null, clients: [] };
  }

  let notice: string | null = null;
  let error: string | null = null;
  try {
    const intent = form.get("intent");
    if (intent === "save") {
      const shop = String(form.get("shop") || "").trim().toLowerCase();
      const clientId = String(form.get("clientId") || "").trim();
      const secret = String(form.get("clientSecret") || "").trim();
      if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new Error("Shop must look like name.myshopify.com");
      if (!clientId || !secret) throw new Error("Client ID and client secret are both required");
      await saveCredential(shop, clientId, secret, String(form.get("label") || ""));
      notice = `Saved credentials for ${shop}`;
    } else if (intent === "delete") {
      await deleteCredential(String(form.get("shop") || ""));
      notice = "Removed";
    }
  } catch (e) {
    error = (e as Error).message;
  }
  return { unlocked: true as const, error, notice, clients: await listCredentials() };
};

const card: CSSProperties = { background: "#fff", border: "1px solid #e3e3e3", borderRadius: 12, padding: 20, marginBottom: 16 };
const input: CSSProperties = { display: "block", width: "100%", padding: "8px 10px", margin: "4px 0 12px", border: "1px solid #bbb", borderRadius: 8, font: "inherit" };
const button: CSSProperties = { background: brand.accent, color: brand.accentText, border: 0, borderRadius: 8, padding: "9px 16px", font: "inherit", cursor: "pointer" };

export default function AdminClients() {
  const result = useActionData<typeof action>();
  const [passcode, setPasscode] = useState("");
  const unlocked = result?.unlocked === true;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "32px auto", padding: "0 16px", color: "#1a1a1a" }}>
      <h1 style={{ marginBottom: 4 }}>{brand.agency} Connector: client apps</h1>
      <p style={{ marginTop: 0, color: "#555" }}>Register each client store&apos;s Shopify app keys. Staff only.</p>

      {!unlocked && (
        <Form method="post" style={card}>
          <input type="hidden" name="intent" value="unlock" />
          {result && !result.unlocked && <p style={{ color: "#b00020" }}>{result.error}</p>}
          <label>
            Passcode
            <input style={input} type="password" name="passcode" autoComplete="off" onChange={(e) => setPasscode(e.target.value)} />
          </label>
          <button style={button} type="submit">Unlock</button>
        </Form>
      )}

      {unlocked && (
        <>
          {result.notice && <p style={{ color: "#0a6b3d" }}>{result.notice}</p>}
          {result.error && <p style={{ color: "#b00020" }}>{result.error}</p>}

          <section style={card}>
            <h2 style={{ marginTop: 0 }}>Add or update a client app</h2>
            <Form method="post">
              <input type="hidden" name="intent" value="save" />
              <input type="hidden" name="passcode" value={passcode} />
              <label>Store address<input style={input} name="shop" placeholder="client-store.myshopify.com" required /></label>
              <label>Client ID<input style={input} name="clientId" required autoComplete="off" /></label>
              <label>Client secret<input style={input} type="password" name="clientSecret" required autoComplete="off" /></label>
              <label>Label (optional)<input style={input} name="label" placeholder="Client name" /></label>
              <button style={button} type="submit">Save</button>
            </Form>
          </section>

          <section style={card}>
            <h2 style={{ marginTop: 0 }}>Registered apps ({result.clients.length})</h2>
            {result.clients.length === 0 && <p>None yet. Stores without an entry use the default app from the environment variables.</p>}
            {result.clients.map((c) => (
              <Form method="post" key={c.shop} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: "1px solid #eee" }}>
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="passcode" value={passcode} />
                <input type="hidden" name="shop" value={c.shop} />
                <span style={{ flex: 1 }}>
                  <strong>{c.shop}</strong>
                  {c.label ? ` · ${c.label}` : ""}
                  <br />
                  <small style={{ color: "#666" }}>Client ID {c.clientId.slice(0, 8)}… · updated {new Date(c.updatedAt).toLocaleDateString("en-GB")}</small>
                </span>
                <button style={{ ...button, background: "#fff", color: "#b00020", border: "1px solid #b00020" }} type="submit">Remove</button>
              </Form>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
