import { BrowserProvider } from "ethers";

/**
 * EIP-1193 wallet plumbing.
 *
 * Discovery is EIP-6963 first (the announce/request handshake), because window.ethereum is
 * a single slot that multiple extensions fight over — with MetaMask and Bridgekey both
 * installed, whoever injected last wins and the user gets the wrong wallet silently.
 * window.ethereum is kept only as a fallback for wallets that never announce.
 */

const discovered = new Map(); // rdns -> { info, provider }
let listening = false;

function startDiscovery() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("eip6963:announceProvider", (event) => {
    const { info, provider } = event.detail;
    discovered.set(info.rdns, { info, provider });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/** @returns {{id: string, name: string, icon?: string, provider: object}[]} */
export function listWallets() {
  startDiscovery();
  const wallets = [...discovered.values()].map(({ info, provider }) => ({
    id: info.rdns,
    name: info.name,
    icon: info.icon,
    provider,
  }));

  if (wallets.length === 0 && typeof window !== "undefined" && window.ethereum) {
    wallets.push({ id: "injected", name: "Injected wallet", provider: window.ethereum });
  }
  return wallets;
}

export async function connect(provider) {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const chainId = await provider.request({ method: "eth_chainId" });
  return { account: accounts?.[0] ?? null, chainId: Number(chainId) };
}

export async function currentAccounts(provider) {
  const accounts = await provider.request({ method: "eth_accounts" });
  return accounts ?? [];
}

/**
 * Ask an RPC endpoint what chain it actually is. The "Add network" flow uses this rather
 * than a hardcoded id: a testnet that gets reset or re-chained would otherwise have every
 * user adding a network entry that silently points at the wrong chain.
 */
export async function chainIdFromRpc(rpcUrl) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  if (!res.ok) throw new Error(`RPC ${rpcUrl} returned ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || "RPC rejected eth_chainId");
  if (!body.result) throw new Error(`RPC ${rpcUrl} returned no chainId`);
  return { hex: body.result, decimal: Number(body.result) };
}

/** Adds (or switches to) the network, using the chainId the RPC reports right now. */
export async function addNetwork(provider, { rpcUrl, chainName, explorerUrl, currency }) {
  const { hex } = await chainIdFromRpc(rpcUrl);

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    return { chainId: hex, added: false };
  } catch (err) {
    // 4902 = chain unknown to the wallet, which is the case worth handling; anything else
    // is a real failure and should surface rather than be swallowed by a blind add.
    if (err?.code !== 4902) throw err;
  }

  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: hex,
        chainName,
        rpcUrls: [rpcUrl],
        nativeCurrency: currency ?? { name: "MST", symbol: "MST", decimals: 18 },
        ...(explorerUrl ? { blockExplorerUrls: [explorerUrl] } : {}),
      },
    ],
  });
  return { chainId: hex, added: true };
}

export function onWalletEvents(provider, { onAccounts, onChain }) {
  const accountsHandler = (accounts) => onAccounts?.(accounts ?? []);
  const chainHandler = (chainId) => onChain?.(Number(chainId));
  provider.on?.("accountsChanged", accountsHandler);
  provider.on?.("chainChanged", chainHandler);
  return () => {
    provider.removeListener?.("accountsChanged", accountsHandler);
    provider.removeListener?.("chainChanged", chainHandler);
  };
}

export const browserProvider = (provider) => new BrowserProvider(provider);

export const shortAddress = (addr) =>
  typeof addr === "string" && addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr ?? "";
