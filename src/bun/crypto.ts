/**
 * E2E Encryption for drop.local transfers
 *
 * Protocol:
 *   1. Each device generates an ephemeral X25519 keypair on startup.
 *   2. Public keys (32 bytes, hex) are exchanged via mDNS TXT records.
 *   3. Before each transfer, sender derives a shared secret via X25519 DH,
 *      then derives a per-transfer AES-256-GCM key via HKDF-SHA256.
 *   4. Each chunk is encrypted: [4-byte BE length][12-byte IV][ciphertext+16-byte tag]
 *   5. Receiver mirrors the derivation using sender's public key.
 *
 * Why X25519 over P-256:
 *   - Constant-time by design (no timing side-channels)
 *   - 3-10× faster key exchange
 *   - Used by Signal, WireGuard, modern SSH
 */

import {
  generateKeyPairSync,
  diffieHellman,
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  createPublicKey,
  createPrivateKey,
} from "crypto";

export interface DeviceKeyPair {
  privateKey: Buffer; // raw 32-byte X25519 private key
  publicKey: Buffer; // raw 32-byte X25519 public key, hex for broadcast
}

export function generateKeyPair(): DeviceKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("x25519", {
    privateKeyEncoding: { type: "pkcs8", format: "der" },
    publicKeyEncoding: { type: "spki", format: "der" },
  });
  // Extract raw 32-byte keys from DER wrappers
  const rawPrivate = Buffer.from(privateKey).slice(-32);
  const rawPublic = Buffer.from(publicKey).slice(-32);
  return { privateKey: rawPrivate, publicKey: rawPublic };
}

/**
 * Derive a 32-byte AES-256-GCM key from our private key + peer's public key.
 * transferId is used as HKDF info to ensure per-transfer key uniqueness.
 */
export function deriveTransferKey(
  myPrivateKey: Buffer,
  peerPublicKeyHex: string,
  transferId: string,
): Buffer {
  const peerRaw = Buffer.from(peerPublicKeyHex, "hex");

  // Wrap raw bytes back into DER key objects for node:crypto diffieHellman()
  const privateKeyObj = createPrivateKey({
    key: buildX25519PrivateDer(myPrivateKey),
    format: "der",
    type: "pkcs8",
  });
  const publicKeyObj = createPublicKey({
    key: buildX25519PublicDer(peerRaw),
    format: "der",
    type: "spki",
  });

  const sharedSecret = diffieHellman({ privateKey: privateKeyObj, publicKey: publicKeyObj });

  return Buffer.from(
    hkdfSync("sha256", sharedSecret, Buffer.alloc(0), Buffer.from(`drop.local:${transferId}`), 32),
  );
}

// ── DER builder helpers ───────────────────────────────────────────────────────
// X25519 SPKI public key DER prefix (RFC 8410): 12 bytes
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
// X25519 PKCS#8 private key DER prefix: 16 bytes
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

function buildX25519PublicDer(raw: Buffer): Buffer {
  return Buffer.concat([X25519_SPKI_PREFIX, raw]);
}

function buildX25519PrivateDer(raw: Buffer): Buffer {
  return Buffer.concat([X25519_PKCS8_PREFIX, raw]);
}

/**
 * Encrypt a buffer with AES-256-GCM.
 * Returns: [4-byte BE payload-length][12-byte IV][ciphertext][16-byte auth-tag]
 */
export function encryptChunk(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, encrypted, tag]); // 12 + n + 16
  const lengthPrefix = Buffer.allocUnsafe(4);
  lengthPrefix.writeUInt32BE(payload.length, 0);
  return Buffer.concat([lengthPrefix, payload]);
}

/**
 * Decrypt a single framed message produced by encryptChunk.
 * Input must be the payload portion (without the 4-byte length prefix).
 */
export function decryptChunk(key: Buffer, payload: Buffer): Buffer {
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(12, payload.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Frame-aware stream decoder.
 * Feed raw TCP bytes in; get back complete decrypted chunks.
 */
export class EncryptedFrameDecoder {
  private buf = Buffer.alloc(0);
  private readonly key: Buffer;

  constructor(key: Buffer) {
    this.key = key;
  }

  /** Returns array of decrypted plaintext buffers from any newly complete frames. */
  push(chunk: Buffer): Buffer[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const results: Buffer[] = [];

    while (this.buf.length >= 4) {
      const frameLen = this.buf.readUInt32BE(0);
      if (this.buf.length < 4 + frameLen) break; // incomplete frame
      const payload = this.buf.subarray(4, 4 + frameLen);
      results.push(decryptChunk(this.key, payload));
      this.buf = this.buf.subarray(4 + frameLen);
    }

    return results;
  }
}
