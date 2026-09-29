import { SigningKey, sha256, ripemd160, getBytes, hexlify, concat, toUtf8Bytes, randomBytes } from "ethers";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

export function base58Encode(bytes: Uint8Array): string {
  let n = BigInt(hexlify(bytes));
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function p2pkhAddress(h160: Uint8Array, version = 0x00): string {
  const payload = concat([new Uint8Array([version]), h160]);
  const checksum = getBytes(sha256(sha256(payload))).slice(0, 4);
  return base58Encode(getBytes(concat([payload, checksum])));
}

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

const hrpExpand = (hrp: string) => [
  ...[...hrp].map((c) => c.charCodeAt(0) >> 5),
  0,
  ...[...hrp].map((c) => c.charCodeAt(0) & 31),
];

/** bech32 (BIP173) P2WPKH: witness version 0 + 20-byte program. */
export function p2wpkhAddress(h160: Uint8Array, hrp = "bc"): string {
  const five: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of h160) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      five.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) five.push((acc << (5 - bits)) & 31);
  const data = [0, ...five];
  const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + "1" + [...data, ...checksum].map((d) => BECH32[d]).join("");
}

export const hash160 = (data: Uint8Array | string): Uint8Array => getBytes(ripemd160(sha256(data)));

/** Bitcoin signed-message digest: sha256d("\x18Bitcoin Signed Message:\n" || varint(len) || msg). */
export function bitcoinMessageDigest(message: Uint8Array): string {
  if (message.length >= 253) throw new Error("message too long for 1-byte varint");
  const prefix = toUtf8Bytes("\x18Bitcoin Signed Message:\n");
  return sha256(sha256(concat([prefix, new Uint8Array([message.length]), message])));
}

/**
 * DEMO KEY: a freshly generated throwaway secp256k1 keypair. It is NOT any real person's or dataset address and must
 * never be presented as proof of ownership of one.
 */
export class DemoKey {
  readonly signingKey: SigningKey;
  constructor(seed: Uint8Array = randomBytes(32)) {
    this.signingKey = new SigningKey(hexlify(seed));
  }
  get compressedPubkey(): Uint8Array {
    return getBytes(this.signingKey.compressedPublicKey);
  }
  get hash160(): Uint8Array {
    return hash160(this.compressedPubkey);
  }
  get p2pkh(): string {
    return p2pkhAddress(this.hash160);
  }
  get p2wpkh(): string {
    return p2wpkhAddress(this.hash160);
  }
  /** x, y of the uncompressed pubkey */
  get xy(): { x: string; y: string } {
    const u = this.signingKey.publicKey; // 0x04 || x || y
    return { x: "0x" + u.slice(4, 68), y: "0x" + u.slice(68, 132) };
  }
  signMessage(message: Uint8Array) {
    const sig = this.signingKey.sign(bitcoinMessageDigest(message));
    return { v: sig.v, r: sig.r, s: sig.s };
  }
}
