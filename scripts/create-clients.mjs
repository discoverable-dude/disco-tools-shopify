#!/usr/bin/env node
// Usage: npm run clients:create -- clients.json --org <organization-id>
//
// Creates a Shopify app for each client from the command line, then configures and releases it,
// and writes the lines to paste into /admin/clients. clients.json:
//   [{ "name": "Acme", "config": "acme", "store": "acme.myshopify.com" }]
// The organization id is in your Dev Dashboard URL: dev.shopify.com/dashboard/<organization-id>
// Safe to re-run: apps already created are remembered in clients.created.json and not repeated.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i > -1 && args[i + 1] ? args[i + 1] : d;
};
const org = flag("org", process.env.SHOPIFY_ORG_ID);
if (!file || !existsSync(file) || !org) {
  console.error("Usage: npm run clients:create -- clients.json --org <organization-id>");
  console.error("(the organization id is the number in dev.shopify.com/dashboard/<number>)");
  process.exit(1);
}

// SHOPIFY_BIN lets tests substitute a stub. Default: npx shopify
const bin = (process.env.SHOPIFY_BIN || "npx shopify").split(" ");
const shopify = (a, opts = {}) => spawnSync(bin[0], [...bin.slice(1), ...a], { encoding: "utf8", ...opts });
const inherit = (cmd, a) => spawnSync(cmd, a, { stdio: "inherit" });

const clients = JSON.parse(readFileSync(file, "utf8"));
const createdFile = "clients.created.json";
const created = existsSync(createdFile) ? JSON.parse(readFileSync(createdFile, "utf8")) : {};
const registerFile = "clients.register.txt"; // contains secrets, git-ignored

// The CLI mixes one-line JSON progress events with the final result, in any order, so find the
// client ID by pattern instead of assuming where the result sits.
const findClientId = (text) => text.match(/"clientId"\s*:\s*"([0-9a-zA-Z]{16,})"/)?.[1];

const lastJson = (text) => {
  // CLI output may contain log lines; take the last JSON object.
  for (let i = text.lastIndexOf("{"); i >= 0; i = text.lastIndexOf("{", i - 1)) {
    try {
      return JSON.parse(text.slice(i));
    } catch {
      // keep scanning backwards
    }
  }
  return null;
};

// Validate everything before creating anything.
const problems = [];
for (const c of clients) {
  const appName = c.appName || `Discoverable - ${c.name}`;
  if (!c.name || !c.config || !c.store) problems.push(`${JSON.stringify(c)}: name, config and store are all required`);
  else if (appName.length > 29) problems.push(`"${appName}" is ${appName.length} characters; Shopify allows 29. Add an "appName" for this client.`);
  else if (!/^[a-z0-9-]+$/.test(c.config)) problems.push(`${c.config}: config names use lower-case letters, numbers and hyphens only`);
  else if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(c.store)) problems.push(`${c.store}: store must look like name.myshopify.com`);
}
if (problems.length) {
  console.error("Fix these first:\n- " + problems.join("\n- "));
  process.exit(1);
}

const results = [];
for (const c of clients) {
  const appName = c.appName || `Discoverable - ${c.name}`;
  console.log(`\n=== ${appName} (${c.store}) ===`);
  // An app that already exists can be given as "clientId" in clients.json (nothing is created).
  let clientId = c.clientId || created[c.config]?.clientId;
  let failed = null;

  // 1. Create the app (skipped when it already exists)
  if (!clientId) {
    const dir = mkdtempSync(join(tmpdir(), "disco-app-"));
    const r = shopify(["app", "init", "--name", appName, "--organization-id", org, "--template", "none", "--no-input", "--json", "--path", dir]);
    rmSync(dir, { recursive: true, force: true });
    const all = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    writeFileSync(`clients.create.${c.config}.log`, all);
    clientId = findClientId(all);
    if (!clientId) {
      console.error(`Could not find the new app's client ID (exit code ${r.status}). Full output saved to clients.create.${c.config}.log`);
      console.error("Check the Dev Dashboard: if the app exists, copy its Client ID into clients.json as \"clientId\" and run again.");
      failed = "create";
    } else {
      if (r.status !== 0) console.warn(`Warning: the CLI exited with code ${r.status} but the app was created.`);
      created[c.config] = { name: appName, store: c.store, clientId };
      writeFileSync(createdFile, JSON.stringify(created, null, 2));
      console.log(`Created app, client ID ${clientId}`);
    }
  } else {
    console.log(`Using existing app, client ID ${clientId}`);
  }

  // 2. Link, configure and release
  const steps = failed
    ? []
    : [
        ["link", () => inherit(bin[0], [...bin.slice(1), "app", "config", "link", "--client-id", clientId, "--file-name", `shopify.app.${c.config}.toml`, "--force", "--no-input"])],
        ["config", () => inherit("node", ["scripts/client-config.mjs", c.config, "--name", appName])],
        ["deploy", () => inherit(bin[0], [...bin.slice(1), "app", "deploy", "--config", c.config, "--force"])],
      ];
  for (const [label, fn] of steps) {
    if (fn().status !== 0) {
      failed = label;
      break;
    }
  }

  // 3. Fetch the client secret for the registration paste (never printed to the screen)
  if (!failed) {
    const r = shopify(["app", "env", "show", "--client-id", clientId, "--json", "--no-input"]);
    const out = lastJson(r.stdout ?? "");
    const secret = out?.variables?.find((v) => v.name === "SHOPIFY_API_SECRET")?.value;
    if (secret) {
      appendFileSync(registerFile, `${c.store}, ${clientId}, ${secret}, ${c.name}\n`);
    } else {
      failed = "secret";
    }
  }
  results.push({ client: c.name, store: c.store, result: failed ? `FAILED at ${failed}` : "done" });
}

console.log("\nSummary");
for (const r of results) console.log(`  ${r.result.padEnd(18)} ${r.client} (${r.store})`);
if (results.some((r) => r.result === "done")) {
  console.log(`\nThe lines to paste into /admin/clients -> "Add several at once" are in ${registerFile} (contains secrets, not committed).`);
}
console.log("\nStill to do per app in the Dev Dashboard: upload the icon, Enable bulk queries, IP allowlist, Distribution -> Custom -> install link.");
process.exit(results.some((r) => r.result !== "done") ? 1 : 0);
