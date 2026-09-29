import { AbiCoder, keccak256 } from "ethers";

// SHARED SPEC v1 flag bits (docs/SHARED_SPEC_v1.md)
export const GEO_TEMPORAL_MISMATCH = 1;
export const CONTESTED_EVIDENCE = 2;
export const EXONERATED = 4;
export const KNOWN_LABEL = 8;

export interface Verdict {
  band: number;
  riskBps: number;
  haircutBps: number;
  cwtBps: number;
  lowerBps: number;
  intent: number;
  flags: number;
}

/** leaf = keccak256(abi.encode(key, epoch, band, riskBps, haircutBps, cwtBps, lowerBps, intent, flags)) */
export const verdictLeaf = (key: string, epoch: number, v: Verdict): string =>
  keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint32", "uint8", "uint16", "uint16", "uint16", "uint16", "uint8", "uint8"],
      [key, epoch, v.band, v.riskBps, v.haircutBps, v.cwtBps, v.lowerBps, v.intent, v.flags]
    )
  );

/** Flat argument list in the order used by verifyVerdict/screen/deposit (after key, epoch). */
export const verdictArgs = (v: Verdict) =>
  [v.band, v.riskBps, v.haircutBps, v.cwtBps, v.lowerBps, v.intent, v.flags] as const;
