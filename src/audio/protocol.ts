import {
  BIT_DURATION_MS,
  MAX_PAYLOAD_BYTES,
  PREAMBLE_BITS,
  SYNC_BITS,
} from "./constants";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type Bit = 0 | 1;

export type DecodeResult =
  | { ok: true; text: string; bytes: Uint8Array; crc: number }
  | { ok: false; reason: string };

export function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

export function byteToBits(value: number): Bit[] {
  const bits: Bit[] = [];
  for (let i = 7; i >= 0; i -= 1) {
    bits.push((((value >> i) & 1) === 1 ? 1 : 0) as Bit);
  }
  return bits;
}

export function bitsToByte(bits: readonly number[]): number {
  return bits.reduce((acc, bit) => (acc << 1) | (bit & 1), 0);
}

export function bytesToBits(bytes: Uint8Array): Bit[] {
  const bits: Bit[] = [];
  for (const byte of bytes) {
    bits.push(...byteToBits(byte));
  }
  return bits;
}

export function bitsToBytes(bits: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = bitsToByte(bits.slice(i * 8, i * 8 + 8));
  }
  return bytes;
}

export function encodeText(text: string): Uint8Array {
  const encoded = textEncoder.encode(text);
  if (encoded.length > MAX_PAYLOAD_BYTES) {
    throw new Error("Payload exceeds " + MAX_PAYLOAD_BYTES + " bytes");
  }
  return encoded;
}

export function decodeText(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function framePayload(payload: Uint8Array): Bit[] {
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new Error("Payload exceeds " + MAX_PAYLOAD_BYTES + " bytes");
  }
  const headerAndBody = new Uint8Array(1 + payload.length);
  headerAndBody[0] = payload.length;
  headerAndBody.set(payload, 1);
  const checksum = crc8(headerAndBody);
  return [
    ...PREAMBLE_BITS,
    ...SYNC_BITS,
    ...bytesToBits(headerAndBody),
    ...byteToBits(checksum),
  ];
}

export function encodeMessage(text: string): Bit[] {
  return framePayload(encodeText(text));
}

export function bitsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((bit, index) => bit === b[index]);
}

export function bitDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) distance += 1;
  }
  return distance;
}

export function findSyncIndex(bits: readonly number[], maxDistance = 1): number {
  if (bits.length < SYNC_BITS.length) return -1;
  let bestIndex = -1;
  let bestDistance = maxDistance + 1;
  for (let i = 0; i <= bits.length - SYNC_BITS.length; i += 1) {
    const distance = bitDistance(bits.slice(i, i + SYNC_BITS.length), SYNC_BITS);
    if (distance === 0) return i;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestDistance <= maxDistance ? bestIndex : -1;
}

export function decodeFramedBits(bits: readonly number[]): DecodeResult {
  const syncIndex = findSyncIndex(bits);
  if (syncIndex < 0) return { ok: false, reason: "Sync word not found" };
  const afterSync = bits.slice(syncIndex + SYNC_BITS.length);
  if (afterSync.length < 16) return { ok: false, reason: "Frame truncated before length/CRC" };
  const length = bitsToByte(afterSync.slice(0, 8));
  if (length > MAX_PAYLOAD_BYTES) return { ok: false, reason: "Invalid length " + length };
  const needed = 8 + length * 8 + 8;
  if (afterSync.length < needed) return { ok: false, reason: "Waiting for remaining bits" };
  const payloadBits = afterSync.slice(8, 8 + length * 8);
  const crcBits = afterSync.slice(8 + length * 8, needed);
  const payload = bitsToBytes(payloadBits);
  const headerAndBody = new Uint8Array(1 + payload.length);
  headerAndBody[0] = length;
  headerAndBody.set(payload, 1);
  const expected = crc8(headerAndBody);
  const received = bitsToByte(crcBits);
  if (expected !== received) {
    return {
      ok: false,
      reason: "CRC mismatch (got " + received + ", expected " + expected + ")",
    };
  }
  return { ok: true, text: decodeText(payload), bytes: payload, crc: received };
}

export function transmissionDurationMs(bitCount: number): number {
  return bitCount * BIT_DURATION_MS;
}

export function formatBitString(bits: readonly number[], group = 8): string {
  return bits
    .map((bit, index) => {
      const value = String(bit);
      return (index + 1) % group === 0 ? value + " " : value;
    })
    .join("")
    .trim();
}
