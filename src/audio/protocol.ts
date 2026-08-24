import {
  BIT_DURATION_MS,
  MAX_PAYLOAD_BYTES,
  PREAMBLE_BITS,
  SYNC_BITS,
} from "./constants";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

export function byteToBits(value: number): number[] {
  const bits = [];
  for (let i = 7; i >= 0; i -= 1) {
    bits.push((value >> i) & 1);
  }
  return bits;
}

export function bitsToByte(bits) {
  return bits.reduce((acc, bit) => (acc << 1) | (bit & 1), 0);
}

export function bytesToBits(bytes) {
  const bits = [];
  for (const byte of bytes) {
    bits.push(...byteToBits(byte));
  }
  return bits;
}

export function bitsToBytes(bits) {
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = bitsToByte(bits.slice(i * 8, i * 8 + 8));
  }
  return bytes;
}

export function encodeText(text) {
  const encoded = textEncoder.encode(text);
  if (encoded.length > MAX_PAYLOAD_BYTES) {
    throw new Error("Payload exceeds " + MAX_PAYLOAD_BYTES + " bytes");
  }
  return encoded;
}

export function decodeText(bytes) {
  return textDecoder.decode(bytes);
}

export function framePayload(payload) {
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new Error("Payload exceeds " + MAX_PAYLOAD_BYTES + " bytes");
  }
  const headerAndBody = new Uint8Array(1 + payload.length);
  headerAndBody[0] = payload.length;
  headerAndBody.set(payload, 1);
  const checksum = crc8(headerAndBody);
  return [...PREAMBLE_BITS, ...SYNC_BITS, ...bytesToBits(headerAndBody), ...byteToBits(checksum)];
}

export function encodeMessage(text) {
  return framePayload(encodeText(text));
}

export function bitsEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((bit, index) => bit === b[index]);
}

export function findSyncIndex(bits) {
  if (bits.length < SYNC_BITS.length) return -1;
  for (let i = 0; i <= bits.length - SYNC_BITS.length; i += 1) {
    if (bitsEqual(bits.slice(i, i + SYNC_BITS.length), SYNC_BITS)) return i;
  }
  return -1;
}

export function decodeFramedBits(bits) {
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
  if (expected !== received) return { ok: false, reason: "CRC mismatch (got " + received + ", expected " + expected + ")" };
  return { ok: true, text: decodeText(payload), bytes: payload, crc: received };
}

export function transmissionDurationMs(bitCount) {
  return bitCount * BIT_DURATION_MS;
}

export function formatBitString(bits, group = 8) {
  return bits.map((bit, index) => {
    const value = String(bit);
    return (index + 1) % group === 0 ? value + " " : value;
  }).join("").trim();
}
