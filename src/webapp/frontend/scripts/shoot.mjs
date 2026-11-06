// Screenshots each On-Chain Verdicts page against whatever chain the backend is pointed
// at, and fails loudly on console errors — a screenshot of a broken page is worse than no
// screenshot, because it looks like evidence.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.SHOT_BASE || "http://127.0.0.1:5000/app/";
const OUT = process.env.SHOT_OUT || "../../../outputs/screenshots";

const PAGES = [
  { id: "screen", label: "Screen", act: async (page) => {
      await page.fill("#screen-addr", "wallet_18ooSDWytsT64KNxzJUvgm5ns4Q2JJZx4y");
      await page.locator(".screenform button[type=submit]").click();
      await page.waitForSelector(".verify", { timeout: 20000 });
    } },
  { id: "gateway", label: "Gateway", act: async (page) => {
      await page.waitForSelector(".policysplit .tbl tbody tr", { timeout: 30000 });
    } },
  { id: "epochs", label: "Epochs", act: async (page) => {
      await page.waitForSelector(".card.epoch", { timeout: 20000 });
    } },
  { id: "appeal", label: "Appeals", act: async (page) => {
      await page.waitForSelector("#appeal-addr", { timeout: 20000 });
    } },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage();

const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

let failed = 0;
for (const spec of PAGES) {
  const before = errors.length;
  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    // The four chain pages live behind one top-level item, then a sub-nav pill.
    await page.locator(".topnav nav button.chain").click();
    await page.locator(".chainnav button", { hasText: new RegExp(`^${spec.label}$`) }).click();
    await spec.act(page);
    await page.waitForTimeout(600); // let entrance motion settle before capture
    await page.screenshot({ path: `${OUT}/${spec.id}.png`, fullPage: true });
    const newErrors = errors.slice(before);
    console.log(`${spec.id.padEnd(8)} captured${newErrors.length ? `  (${newErrors.length} console errors)` : ""}`);
    newErrors.forEach((e) => console.log(`           ! ${e.slice(0, 160)}`));
    if (newErrors.length) failed++;
  } catch (err) {
    failed++;
    console.log(`${spec.id.padEnd(8)} FAILED: ${err.message.split("\n")[0]}`);
    await page.screenshot({ path: `${OUT}/${spec.id}-FAILED.png`, fullPage: true }).catch(() => {});
  }
}

await browser.close();
console.log(failed === 0 ? "\nall pages rendered clean" : `\n${failed} page(s) had problems`);
process.exitCode = failed === 0 ? 0 : 1;
