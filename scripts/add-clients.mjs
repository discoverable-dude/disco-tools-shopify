#!/usr/bin/env node
// Usage: npm run clients:add -- clients.json
// For each client: link the existing app (created in the Dev Dashboard), write its config from
// the template, and deploy + release it. clients.json is an array of
//   { "name": "Acme", "config": "acme", "clientId": "<Client ID from the app's Settings>" }
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error("Usage: npm run clients:add -- clients.json   (see clients.example.json)");
  process.exit(1);
}
const clients = JSON.parse(readFileSync(file, "utf8"));
const run = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });

// Validate everything first so a typo doesn't leave half the clients set up.
const problems = [];
for (const c of clients) {
  const appName = `Discoverable - ${c.name}`;
  if (!c.name || !c.config || !c.clientId) problems.push(`${JSON.stringify(c)}: name, config and clientId are all required`);
  else if (appName.length > 29) problems.push(`"${appName}" is ${appName.length} characters; Shopify allows 29. Shorten the name.`);
  else if (!/^[a-z0-9-]+$/.test(c.config)) problems.push(`${c.config}: config names use lower-case letters, numbers and hyphens only`);
}
if (problems.length) {
  console.error("Fix these first:\n- " + problems.join("\n- "));
  process.exit(1);
}

const results = [];
for (const c of clients) {
  const appName = `Discoverable - ${c.name}`;
  console.log(`\n=== ${appName} (${c.config}) ===`);
  const steps = [
    ["link", () => run("npx", ["shopify", "app", "config", "link", "--client-id", c.clientId, "--file-name", `shopify.app.${c.config}.toml`, "--force", "--no-input"])],
    ["config", () => run("node", ["scripts/client-config.mjs", c.config, "--name", appName])],
    ["deploy", () => run("npx", ["shopify", "app", "deploy", "--config", c.config, "--force"])],
  ];
  let failed = null;
  for (const [label, fn] of steps) {
    const r = fn();
    if (r.status !== 0) {
      failed = label;
      break;
    }
  }
  results.push({ client: c.name, config: c.config, result: failed ? `FAILED at ${failed}` : "done" });
}

console.log("\nSummary");
for (const r of results) console.log(`  ${r.result.padEnd(18)} ${r.client} (${r.config})`);
console.log("\nStill to do per app in the Dev Dashboard: Enable bulk queries, IP allowlist, Distribution -> Custom -> install link.");
process.exit(results.some((r) => r.result !== "done") ? 1 : 0);
