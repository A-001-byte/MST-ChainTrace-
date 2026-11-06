import { useState } from "react";
import { shortAddress } from "../../lib/chain/wallet";

/**
 * Wallet connection strip. Shows the chain the wallet is actually on versus the chain the
 * deployment expects, because a silent mismatch is how a demo ends up reading an empty
 * contract on the wrong network and calling it "no results".
 */
export default function WalletBar({ wallet, deployment }) {
  const { wallets, account, chainId, error, busy, connectWallet, addChain, connected } = wallet;
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState(null);

  // the deployment record stores chainId as a string; the wallet reports a number
  const expected = deployment?.chainId != null ? Number(deployment.chainId) : null;
  const mismatch = connected && expected != null && chainId != null && chainId !== expected;

  const onAdd = async () => {
    setNotice(null);
    const result = await addChain({
      rpcUrl: deployment.rpcUrl,
      chainName: deployment.chainName || "MST Testnet",
      explorerUrl: deployment.explorerUrl,
    });
    if (result) {
      setNotice(
        result.added
          ? `Added ${deployment.chainName} (chainId ${parseInt(result.chainId, 16)}, read from the RPC).`
          : `Switched to chainId ${parseInt(result.chainId, 16)}.`
      );
    }
  };

  return (
    <div className="walletbar">
      <div className="row">
        {!connected ? (
          <>
            <button className="btn sm primary" disabled={busy} onClick={() => setPicking((p) => !p)}>
              {busy ? "Connecting…" : "Connect wallet"}
            </button>
            {picking && (
              <div className="wlist" role="menu">
                {wallets.length === 0 && (
                  <span className="meta">No EIP-1193 wallet detected. Install MetaMask or Bridgekey.</span>
                )}
                {wallets.map((w) => (
                  <button key={w.id} className="btn sm" role="menuitem"
                    onClick={async () => { await connectWallet(w); setPicking(false); }}>
                    {w.icon && <img src={w.icon} alt="" width="14" height="14" />}
                    {w.name}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <span className="acct">
            <i aria-hidden="true" />
            <span className="mono">{shortAddress(account)}</span>
            <span className="meta">chain {chainId ?? "—"}</span>
          </span>
        )}

        {connected && deployment?.rpcUrl && (
          <button className="btn sm" disabled={busy} onClick={onAdd}>
            Add {deployment.chainName || "MST Testnet"}
          </button>
        )}
      </div>

      {mismatch && (
        <p className="note down" role="alert">
          Wallet is on chain {chainId}, contracts are deployed on {expected}. Reads below use the
          deployment RPC; writes will fail until you switch.
        </p>
      )}
      {notice && <p className="note">{notice}</p>}
      {error && <p className="note down">{error}</p>}
    </div>
  );
}
