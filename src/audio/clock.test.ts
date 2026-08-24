import { describe, expect, it } from "vitest";
import { BIT_DURATION_MS } from "./constants";
import { BitSlicer, decisionsFromBits, sampleFixedInterval } from "./clock";
import { decodeFramedBits, encodeMessage, type Bit } from "./protocol";

function recover(bits: readonly Bit[]): Bit[] {
  const slicer = new BitSlicer();
  for (const sample of decisionsFromBits(bits)) {
    slicer.push(sample.now, sample.decision);
  }
  slicer.push(bits.length * BIT_DURATION_MS + 400, null);
  return slicer.bits;
}

describe("BitSlicer clock recovery", () => {
  it("recovers alternating preamble bits", () => {
    const bits: Bit[] = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    expect(recover(bits)).toEqual(bits);
  });

  it("recovers runs of the same bit", () => {
    const bits: Bit[] = [1, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 1];
    expect(recover(bits)).toEqual(bits);
  });

  it("round-trips a framed message through a smeared decision stream", () => {
    const framed = encodeMessage("hello fsk");
    const recovered = recover(framed);
    const decoded = decodeFramedBits(recovered);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.text).toBe("hello fsk");
    }
  });

  it("the old 0.85-interval sampler drifts and fails to decode", () => {
    const framed = encodeMessage("hello fsk");
    const naive = sampleFixedInterval(decisionsFromBits(framed, { smearMs: 0, detectDelayMs: 8 }));
    const decoded = decodeFramedBits(naive);
    expect(decoded.ok).toBe(false);
  });
});
