/**
 * E2E Encryption for drop.local transfers
 *
 * Protocol:
 *   1. Each device generates an ephemeral ECDH P-256 keypair on startup.
 *   2. Public keys are exchanged via UDP announce broadcast.
 *   3. Before each transfer, sender derives a shared secret via ECDH,
 *      then derives a per-transfer AES-256-GCM key via HKDF-SHA256.
 *   4. Each chunk is encrypted: [4-byte BE length][12-byte IV][ciphertext+16-byte tag]
 *   5. Receiver mirrors the derivation using sender's public key.
 */

import { createECDH, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

const CURVE = "prime256v1"; // P-256

export interface DeviceKeyPair {
  privateKey: Buffer;
  publicKey: Buffer; // uncompressed 65-byte point, hex for broadcast
}

export function generateKeyPair(): DeviceKeyPair {
  const ecdh = createECDH(CURVE);
  ecdh.generateKeys();
  return {
    privateKey: ecdh.getPrivateKey(),
    publicKey: ecdh.getPublicKey(),
  };
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
  const ecdh = createECDH(CURVE);
  ecdh.setPrivateKey(myPrivateKey);
  const sharedSecret = ecdh.computeSecret(Buffer.from(peerPublicKeyHex, "hex"));

  const key = Buffer.from(
    hkdfSync("sha256", sharedSecret, Buffer.alloc(0), Buffer.from(`drop.local:${transferId}`), 32),
  );
  return key;
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
