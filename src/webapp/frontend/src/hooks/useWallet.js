import { useCallback, useEffect, useState } from "react";
import {
  addNetwork,
  browserProvider,
  connect,
  currentAccounts,
  listWallets,
  onWalletEvents,
} from "../lib/chain/wallet";

/**
 * Wallet connection state. Deliberately does NOT auto-connect on mount — it only restores
 * a session the user already granted (eth_accounts, which never prompts).
 */
export function useWallet() {
  // Read whatever has announced itself already; the effect below re-reads once for slow extensions.
  const [wallets, setWallets] = useState(listWallets);
  const [selected, setSelected] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Wallets announce asynchronously; re-read shortly after mount so a slow extension
    // still appears without the user having to reload.
    const timer = setTimeout(() => setWallets(listWallets()), 400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!selected) return undefined;
    let cancelled = false;

    currentAccounts(selected.provider)
      .then((accounts) => { if (!cancelled && accounts.length) setAccount(accounts[0]); })
      .catch(() => {});

    selected.provider
      .request({ method: "eth_chainId" })
      .then((id) => { if (!cancelled) setChainId(Number(id)); })
      .catch(() => {});

    const off = onWalletEvents(selected.provider, {
      onAccounts: (accounts) => setAccount(accounts[0] ?? null),
      onChain: (id) => setChainId(id),
    });

    return () => { cancelled = true; off(); };
  }, [selected]);

  const connectWallet = useCallback(async (wallet) => {
    setBusy(true);
    setError(null);
    try {
      const target = wallet ?? wallets[0];
      if (!target) throw new Error("No EIP-1193 wallet detected. Install MetaMask or Bridgekey.");
      const { account: acct, chainId: id } = await connect(target.provider);
      setSelected(target);
      setAccount(acct);
      setChainId(id);
      return target;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [wallets]);

  const addChain = useCallback(async (opts) => {
    if (!selected) throw new Error("connect a wallet first");
    setBusy(true);
    setError(null);
    try {
      return await addNetwork(selected.provider, opts);
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [selected]);

  const signer = useCallback(async () => {
    if (!selected) throw new Error("connect a wallet first");
    return browserProvider(selected.provider).getSigner();
  }, [selected]);

  const disconnect = useCallback(() => {
    setSelected(null);
    setAccount(null);
    setChainId(null);
  }, []);

  return {
    wallets, selected, account, chainId, error, busy,
    connectWallet, addChain, signer, disconnect,
    connected: Boolean(account),
  };
}
