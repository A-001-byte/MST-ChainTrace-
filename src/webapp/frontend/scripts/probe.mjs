import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE || "http://127.0.0.1:5000/app/";
const OUT = process.env.SHOT_OUT || "../../../outputs/screenshots";
const ADDR = process.env.PROBE_ADDR || "wallet_18ooSDWytsT64KNxzJUvgm5ns4Q2JJZx4y";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1560, height: 1040 }, deviceScaleFactor: 2 });
const page = await context.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator(".runbtn").first().click();
await page.waitForTimeout(2500);

const navText = await page.locator("nav button, .navlink, aside button").evaluateAll((els) =>
  [...new Set(els.map((e) => (e.innerText || "").trim()).filter(Boolean))]
);
console.log("nav items:", navText.join(" | ") || "(none found)");

// Reach the Screen page, whatever it is called in this shell.
for (const label of ["Screen", "On-chain", "On-Chain"]) {
  const btn = page.locator("button", { hasText: new RegExp(`^${label}$`) }).first();
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(1200); }
}

const field = page.locator("#screen-addr");
if (await field.count()) {
  await field.fill(ADDR);
  await page.locator(".screenform button[type=submit]").click();
  await page.waitForTimeout(4000);
  const card = await page.locator(".card").last().innerText().catch(() => "(no card)");
  console.log("\n--- result card ---\n" + card.slice(0, 900));
  await page.screenshot({ path: `${OUT}/screen-after-restart.png`, fullPage: true });
} else {
  console.log("\n#screen-addr not reachable; current headings:",
    (await page.locator("h1, h2").allInnerTexts()).join(" / "));
  await page.screenshot({ path: `${OUT}/probe-state.png`, fullPage: true });
}

console.log(errors.length ? `\nconsole errors: ${errors.length}` : "\nno console errors");
errors.slice(0, 5).forEach((e) => console.log("  ! " + e.slice(0, 180)));
await browser.close();
process.exitCode = errors.length ? 1 : 0;
