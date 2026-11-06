// End-to-end smoke test: signs in, opens every console page, and fails on any page error,
// console error, or failing /api call. Run against a live server:
//
//   node scripts/smoke.mjs                                  (default http://127.0.0.1:5000/app/)
//   SMOKE_BASE=http://127.0.0.1:5050/app/ node scripts/smoke.mjs
//   SMOKE_OUT=../../../outputs/screenshots node scripts/smoke.mjs   (also saves screenshots)
//
// Credentials default to the README's demo account; override with SMOKE_ID / SMOKE_PASS.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:5000/app/";
const OUT = process.env.SMOKE_OUT;
const ID = process.env.SMOKE_ID || "NTRO-CYB-4471";
const PASS = process.env.SMOKE_PASS || "Tr4ce-the-Chain!";

const PAGES = [
  ["F1", "Overview"], ["F2", "Alerts"], ["F3", "Forensic graph"], ["F4", "Kick Down Doors"],
  ["F5", "Adversarial provenance"], ["F6", "Geo-temporal intelligence"], ["F7", "Intent intelligence"], ["F8", "System"],
];
const CHAIN = ["Screen", "Appeals", "Gateway", "Epochs"];

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
});
if (OUT) mkdirSync(OUT, { recursive: true });
const shot = async (name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` }); };

try {
  await page.goto(BASE);
  await page.fill("#inv-id", ID);
  await page.fill("#inv-pass", PASS);
  await page.click(".runbtn");
  await page.waitForSelector(".side", { timeout: 30000 });
  console.log(`signed in as ${ID}`);

  for (const [key, title] of PAGES) {
    await page.keyboard.press(key);
    await page.getByRole("heading", { level: 1, name: title }).waitFor({ timeout: 60000 });
    await shot(title.toLowerCase().replace(/\W+/g, "-"));
    console.log(`ok  ${title}`);
  }
  await page.locator(".navbtn.chain").click();
  for (const label of CHAIN) {
    await page.locator(".subnav .navbtn", { hasText: label }).click();
    await page.locator("h1").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    await shot(`chain-${label.toLowerCase()}`);
    console.log(`ok  On-chain / ${label}`);
  }
} catch (err) {
  problems.push(`flow: ${err.message.split("\n")[0]}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("\nsmoke test passed");
