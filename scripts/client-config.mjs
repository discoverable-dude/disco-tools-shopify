#!/usr/bin/env node
// Usage: npm run client:config -- <config-name> [--name "App name"] [--url https://host]
// Reads shopify.app.<config-name>.toml (created by `shopify app config link`), keeps its
// client_id, and rewrites everything else from shopify.app.template.toml.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const config = args[0];
if (!config || config.startsWith("--")) {
  console.error("Usage: npm run client:config -- <config-name> [--name \"App name\"] [--url https://host]");
  process.exit(1);
}
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i > -1 && args[i + 1] ? args[i + 1] : d;
};

const file = `shopify.app.${config}.toml`;
if (!existsSync(file)) {
  console.error(`${file} not found. Run: npx shopify app config link  (name the config "${config}")`);
  process.exit(1);
}
const clientId = readFileSync(file, "utf8").match(/^client_id\s*=\s*"([^"]+)"/m)?.[1];
if (!clientId) {
  console.error(`No client_id found in ${file}`);
  process.exit(1);
}

const url = flag("url", process.env.SHOPIFY_APP_URL || "https://disco-tools-shopify.vercel.app").replace(/\/$/, "");
const out = readFileSync("shopify.app.template.toml", "utf8")
  .replaceAll("__CLIENT_ID__", clientId)
  .replaceAll("__NAME__", flag("name", "Discoverable Tools"))
  .replaceAll("__APP_URL__", url);
writeFileSync(file, out);
console.log(`Wrote ${file} (client_id ${clientId}, url ${url}).`);
console.log(`Next: npx shopify app deploy --config ${config}`);
