import { describe, expect, it } from "vitest";
import { MAX_PAYLOAD_BYTES } from "./constants";
import {
  crc8,
  decodeFramedBits,
  encodeMessage,
  findSyncIndex,
  formatBitString,
  transmissionDurationMs,
} from "./protocol";

describe("FSK frame codec", () => {
  it("round-trips a short message", () => {
    const bits = encodeMessage("hello fsk");
    const decoded = decodeFramedBits(bits);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.text).toBe("hello fsk");
    }
  });

  it("finds the sync word after the preamble", () => {
    const bits = encodeMessage("ok");
    expect(findSyncIndex(bits)).toBe(16);
  });

  it("accepts a one-bit error in the sync word", () => {
    const bits = encodeMessage("ok");
    bits[20] = bits[20] === 1 ? 0 : 1;
    expect(findSyncIndex(bits, 1)).toBe(16);
    expect(findSyncIndex(bits, 0)).toBe(-1);
  });

  it("rejects a flipped payload bit", () => {
    const bits = encodeMessage("crc");
    bits[40] = bits[40] === 1 ? 0 : 1;
    const decoded = decodeFramedBits(bits);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.reason).toMatch(/CRC mismatch/);
    }
  });

  it("rejects oversized payloads", () => {
    expect(() => encodeMessage("x".repeat(MAX_PAYLOAD_BYTES + 1))).toThrow(/Payload exceeds/);
  });

  it("formats bits and estimates duration", () => {
    expect(formatBitString([1, 0, 1, 1, 0, 0, 0, 1, 1])).toBe("10110001 1");
    expect(transmissionDurationMs(10)).toBe(1000);
    expect(crc8(new Uint8Array([1, 2, 3]))).toBeGreaterThanOrEqual(0);
  });
});
