import { solidityPacked, keccak256 } from "ethers";

export const EXONERATED = 1;
export const CONTESTED_EVIDENCE = 2;

export interface Verdict {
  band: number;
  riskBps: number;
  haircutBps: number;
  cwtBps: number;
  lowerBps: number;
  intent: number;
  flags: number;
}

export const verdictLeaf = (key: string, epoch: number, v: Verdict): string =>
  keccak256(
    solidityPacked(
      ["uint8", "bytes32", "uint32", "uint8", "uint16", "uint16", "uint16", "uint16", "uint8", "uint16"],
      [1, key, epoch, v.band, v.riskBps, v.haircutBps, v.cwtBps, v.lowerBps, v.intent, v.flags]
    )
  );

/** Flat argument list in the order used by verifyVerdict/screen/deposit (after key, epoch). */
export const verdictArgs = (v: Verdict) =>
  [v.band, v.riskBps, v.haircutBps, v.cwtBps, v.lowerBps, v.intent, v.flags] as const;
