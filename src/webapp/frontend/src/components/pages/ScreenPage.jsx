import { useState } from "react";
import { PageHead, Section, Card, Empty, ErrorCard, Reveal } from "../ui";
import VerdictCard from "../verdicts/VerdictCard";
import WalletBar from "../verdicts/WalletBar";
import { useVerdict } from "../../hooks/useChain";
import { explorerAddressUrl } from "../../lib/chain/contracts";

export default function ScreenPage({ deployment, wallet, onChallenge }) {
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState(null);
  const { data, error, loading } = useVerdict(deployment, submitted);

  const oracleAddress = deployment?.contracts?.VerdictOracle?.address;

  return (
    <Section>
      <PageHead
        title="Screen an address"
        sub="Look up a Bitcoin address against the committed verdict set. Every result is verified twice — once in this browser, once by VerdictOracle on MST testnet. Absence is provable too: the sparse Merkle tree proves an empty leaf."
        right={<WalletBar wallet={wallet} deployment={deployment} />}
      />

      <Card>
        <form
          className="screenform"
          onSubmit={(e) => { e.preventDefault(); const v = input.trim(); if (v) setSubmitted(v); }}
        >
          <label className="label" htmlFor="screen-addr">Bitcoin address or node id</label>
          <div className="row">
            <input
              id="screen-addr"
              className="inp mono"
              placeholder="wallet_1H91HHDt3bEgv3zHk1GqXYnkANJfjHLSZC"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoComplete="off"
              spellCheck="false"
            />
            <button className="btn primary" type="submit" disabled={!input.trim() || loading}>
              {loading ? "Screening…" : "Screen"}
            </button>
          </div>
          <p className="note">
            Screening reads already-committed output. It does not re-run the pipeline and does
            not send the address anywhere except the chain RPC.
          </p>
        </form>
      </Card>

      {error && <ErrorCard error={error} />}

      {!submitted && !error && (
        <Empty>Enter an address to see its committed verdict.</Empty>
      )}

      {data && (
        <Reveal>
          <VerdictCard
            verdict={data}
            explorerUrl={oracleAddress ? explorerAddressUrl(deployment, oracleAddress) : null}
            onChallenge={data.found ? onChallenge : null}
          />
        </Reveal>
      )}
    </Section>
  );
}
