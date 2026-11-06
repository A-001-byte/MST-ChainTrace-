// Drives the write paths through the actual UI and reports the tx hashes it produced.
//
// A pass-through EIP-1193 provider is injected and announced over EIP-6963. It forwards
// every call to the local node, whose accounts are unlocked, so eth_sendTransaction needs
// no in-browser signing. The point is that the button in the page is what sends the
// transaction — not a script calling the contract behind the UI's back.

import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE || "http://127.0.0.1:5000/app/";
const RPC = process.env.CHAIN_RPC_URL || "http://127.0.0.1:8545";
const OUT = process.env.SHOT_OUT || "../../../outputs/screenshots";

const INJECT = (rpc) => {
  let id = 0;
  const call = async (method, params = []) => {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const body = await res.json();
    if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code });
    return body.result;
  };

  const provider = {
    isMetaMask: false,
    request: async ({ method, params }) => {
      if (method === "eth_requestAccounts") return call("eth_accounts");
      return call(method, params);
    },
    on() {}, removeListener() {},
  };

  const info = {
    uuid: "11111111-2222-3333-4444-555555555555",
    name: "Local Test Wallet",
    rdns: "dev.local.testwallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
  };

  window.ethereum = provider;
  const announce = () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info, provider } }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await context.addInitScript(INJECT, RPC);
const page = await context.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

const results = [];

async function openChain(label) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator(".topnav nav button.chain").click();
  await page.locator(".chainnav button", { hasText: new RegExp(`^${label}$`) }).click();
}

async function connect() {
  await page.locator(".walletbar button", { hasText: "Connect wallet" }).first().click();
  await page.locator(".wlist button").first().click();
  await page.waitForSelector(".walletbar .acct", { timeout: 15000 });
}

// --- 1. a real deposit, sent by the Deposit button -------------------------------
await openChain("Gateway");
await page.waitForSelector(".policysplit .tbl tbody tr", { timeout: 30000 });
await connect();

const firstAddr = await page.locator(".policysplit .tbl tbody tr td.mono").first().innerText();
await page.selectOption('select[aria-label="Address"]', firstAddr.trim());
await page.selectOption('select[aria-label="Policy"]', "0"); // HAIRCUT: this address freezes
await page.locator("button", { hasText: /^Deposit$/ }).click();
await page.waitForSelector(".note.up", { timeout: 45000 });
const depositLine = await page.locator(".note.up").first().innerText();
results.push(["gateway deposit (HAIRCUT)", depositLine.trim().replace(/\s+/g, " ")]);
await page.screenshot({ path: `${OUT}/gateway-live-tx.png`, fullPage: true });

// --- 2. a real challenge, sent by the Submit button ------------------------------
await openChain("Appeals");
await connect();
await page.fill("#appeal-addr", `wallet_${firstAddr.trim()}`);
await page.fill("#appeal-reason", "Custody-weighted score clears this address; haircut froze it.");
await page.locator("button", { hasText: "Submit challenge" }).click();
await page.waitForSelector(".note.up", { timeout: 45000 });
const challengeLine = await page.locator(".note.up").first().innerText();
results.push(["appeal challenge", challengeLine.trim().replace(/\s+/g, " ")]);
await page.waitForSelector(".timeline", { timeout: 20000 });
await page.screenshot({ path: `${OUT}/appeal-live-tx.png`, fullPage: true });

await browser.close();

console.log("\nTransactions sent by clicking the UI:");
for (const [what, line] of results) console.log(`  ${what}\n    ${line}`);
if (errors.length) {
  console.log(`\nconsole errors (${errors.length}):`);
  errors.slice(0, 5).forEach((e) => console.log(`  ! ${e.slice(0, 200)}`));
}
process.exitCode = results.length === 2 && errors.length === 0 ? 0 : 1;
