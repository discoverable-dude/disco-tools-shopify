import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { verifyPlatformRequest } from "../platform.server";

/**
 * POST /api/push/seo  (signed by the platform)
 * { shop, resource: "product" | "collection", id: "gid://...", dryRun?: boolean,
 *   changes: { title?, handle?, seoTitle?, seoDescription?, descriptionHtml? } }
 * Or { shop, rollback: "<PushAudit id>" } to restore the previous values.
 */
type Changes = {
  title?: string;
  handle?: string;
  seoTitle?: string;
  seoDescription?: string;
  descriptionHtml?: string;
};

const READ = {
  product: `#graphql
    query($id: ID!) { node(id: $id) { ... on Product { title handle descriptionHtml seo { title description } } } }`,
  collection: `#graphql
    query($id: ID!) { node(id: $id) { ... on Collection { title handle descriptionHtml seo { title description } } } }`,
};
const WRITE = {
  product: `#graphql
    mutation($input: ProductUpdateInput!) { productUpdate(product: $input) { userErrors { field message } } }`,
  collection: `#graphql
    mutation($input: CollectionInput!) { collectionUpdate(input: $input) { userErrors { field message } } }`,
};

function toInput(id: string, c: Changes) {
  const input: Record<string, unknown> = { id };
  if (c.title !== undefined) input.title = c.title;
  if (c.handle !== undefined) input.handle = c.handle;
  if (c.descriptionHtml !== undefined) input.descriptionHtml = c.descriptionHtml;
  if (c.seoTitle !== undefined || c.seoDescription !== undefined) {
    input.seo = {
      ...(c.seoTitle !== undefined && { title: c.seoTitle }),
      ...(c.seoDescription !== undefined && { description: c.seoDescription }),
    };
  }
  return input;
}

type Node = {
  title: string;
  handle: string;
  descriptionHtml: string;
  seo?: { title?: string | null; description?: string | null } | null;
};

function snapshot(node: Node): Changes {
  return {
    title: node.title,
    handle: node.handle,
    descriptionHtml: node.descriptionHtml,
    seoTitle: node.seo?.title ?? "",
    seoDescription: node.seo?.description ?? "",
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const verified = await verifyPlatformRequest(request);
  if (!verified.ok) return new Response(null, { status: verified.status });

  const body = JSON.parse(verified.body);
  const link = await db.shopLink.findUnique({ where: { shop: body.shop } });
  if (!link || link.status === "uninstalled") {
    return Response.json({ error: "Unknown or uninstalled shop" }, { status: 404 });
  }
  const { admin } = await unauthenticated.admin(body.shop);

  let resource: "product" | "collection";
  let id: string;
  let changes: Changes;
  let rollbackOf: string | null = null;

  if (body.rollback) {
    const audit = await db.pushAudit.findFirst({ where: { id: body.rollback, shop: body.shop } });
    if (!audit || audit.status !== "applied") {
      return Response.json({ error: "Nothing to roll back" }, { status: 404 });
    }
    resource = audit.resource as typeof resource;
    id = audit.resourceId;
    changes = JSON.parse(audit.previous);
    rollbackOf = audit.id;
  } else {
    resource = body.resource;
    id = body.id;
    changes = body.changes ?? {};
    if (!(resource in READ) || typeof id !== "string" || !id.startsWith("gid://shopify/")) {
      return Response.json({ error: "Invalid resource or id" }, { status: 400 });
    }
  }

  const current = (await (await admin.graphql(READ[resource], { variables: { id } })).json()).data?.node;
  if (!current) return Response.json({ error: "Resource not found" }, { status: 404 });
  const before = snapshot(current);

  // Only record the fields being changed.
  const previous: Changes = {};
  for (const k of Object.keys(changes) as (keyof Changes)[]) previous[k] = before[k];

  if (body.dryRun) return Response.json({ dryRun: true, previous, changes });

  const res = await admin.graphql(WRITE[resource], { variables: { input: toInput(id, changes) } });
  const json = await res.json();
  const errors = (json.data?.productUpdate ?? json.data?.collectionUpdate)?.userErrors ?? [];
  const error = errors.map((e: { message: string }) => e.message).join("; ") || null;

  const audit = await db.pushAudit.create({
    data: {
      shop: body.shop,
      resource,
      resourceId: id,
      changes: JSON.stringify(changes),
      previous: JSON.stringify(previous),
      status: error ? "failed" : "applied",
      error,
    },
  });
  if (!error && rollbackOf) {
    await db.pushAudit.update({ where: { id: rollbackOf }, data: { status: "rolled_back" } });
  }
  return Response.json(error ? { error, auditId: audit.id } : { ok: true, auditId: audit.id }, { status: error ? 422 : 200 });
};
