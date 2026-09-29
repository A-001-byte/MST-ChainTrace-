import { keccak256, concat, ZeroHash, zeroPadValue, toBeHex } from "ethers";

const DEPTH = 256;

export const DEFAULTS: string[] = (() => {
  const d = [ZeroHash];
  for (let i = 0; i < DEPTH; i++) d.push(keccak256(concat([d[i], d[i]])));
  return d;
})();
export const EMPTY_ROOT = DEFAULTS[DEPTH];

const H = (l: string, r: string) => keccak256(concat([l, r]));

export interface CompressedProof {
  bitmap: bigint;
  siblings: string[];
}

/**
 * Test-only reference Sparse Merkle Tree implementing contracts/SPEC.md.
 * NOT a source of golden vectors - those come from Member 1's smt_vectors.json.
 */
export class SparseMerkleTree {
  private nodes = new Map<string, string>();

  private get(level: number, idx: bigint): string {
    return this.nodes.get(`${level}:${idx}`) ?? DEFAULTS[level];
  }

  get root(): string {
    return this.get(DEPTH, 0n);
  }

  set(key: string, leaf: string): void {
    const k = BigInt(key);
    let cur = leaf;
    this.nodes.set(`0:${k}`, cur);
    for (let level = 0; level < DEPTH; level++) {
      const idx = k >> BigInt(level);
      const sib = this.get(level, idx ^ 1n);
      cur = idx & 1n ? H(sib, cur) : H(cur, sib);
      this.nodes.set(`${level + 1}:${idx >> 1n}`, cur);
    }
  }

  leaf(key: string): string {
    return this.get(0, BigInt(key));
  }

  prove(key: string): CompressedProof {
    const k = BigInt(key);
    let bitmap = 0n;
    const siblings: string[] = [];
    for (let level = 0; level < DEPTH; level++) {
      const sib = this.get(level, (k >> BigInt(level)) ^ 1n);
      if (sib !== DEFAULTS[level]) {
        bitmap |= 1n << BigInt(level);
        siblings.push(sib);
      }
    }
    return { bitmap, siblings };
  }
}

export const keyFrom = (n: bigint | number) => zeroPadValue(toBeHex(n), 32);
