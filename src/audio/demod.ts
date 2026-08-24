import { BIT_DURATION_MS, HOP_SAMPLES, TARGET_SAMPLE_RATE } from "./constants";
import { majorityBit } from "./classify";
import { decideHop, type SoftHop } from "./dsp";
import { decodeFramedBits, findSyncIndex, type Bit, type DecodeResult } from "./protocol";

export interface FrameRecovery {
  bits: Bit[];
  decoded: DecodeResult;
  hopsPerBit: number;
  phase: number;
}

export interface BitCompare {
  offset: number;
  matches: number;
  compared: number;
}

export function estimateNoiseFloor(hops: readonly SoftHop[]): number {
  if (hops.length === 0) return 1e-12;
  const weak = hops.map((hop) => Math.min(hop.p0, hop.p1)).sort((a, b) => a - b);
  return weak[Math.floor(weak.length * 0.3)] || 1e-12;
}

function hopIntervalMs(hops: readonly SoftHop[]): number {
  return hops.length >= 2 ? Math.max(4, hops[1].now - hops[0].now) : (HOP_SAMPLES / TARGET_SAMPLE_RATE) * 1000;
}

function bitPeriodCandidates(hops: readonly SoftHop[]): number[] {
  const center = BIT_DURATION_MS / hopIntervalMs(hops);
  return [0.9, 0.94, 0.97, 1, 1.03, 1.06, 1.1]
    .map((scale) => center * scale)
    .filter((value) => value >= 4 && value <= 18);
}

function symbolBit(hops: readonly SoftHop[], start: number, hopsPerBit: number, noiseFloor: number): Bit | null {
  const votes: Bit[] = [];
  const from = start + Math.floor(hopsPerBit * 0.25);
  const to = Math.min(hops.length, start + Math.ceil(hopsPerBit * 0.85));
  for (let i = from; i < to; i += 1) {
    const decision = decideHop(hops[i], noiseFloor);
    if (decision !== null) votes.push(decision);
  }
  if (votes.length === 0) {
    for (let i = start; i < Math.min(hops.length, start + hopsPerBit); i += 1) {
      const decision = decideHop(hops[i], noiseFloor);
      if (decision !== null) votes.push(decision);
    }
  }
  return majorityBit(votes);
}

function bitsForTiming(
  hops: readonly SoftHop[],
  phase: number,
  bitHops: number,
  noiseFloor: number,
): Bit[] {
  const bits: Bit[] = [];
  const window = Math.max(4, Math.round(bitHops));
  for (let n = 0; ; n += 1) {
    const start = Math.round(phase + n * bitHops);
    if (start + Math.ceil(window * 0.5) > hops.length) break;
    const bit = symbolBit(hops, start, window, noiseFloor);
    if (bit !== null) bits.push(bit);
  }
  return bits;
}

function scoreRecovery(bits: Bit[], decoded: DecodeResult): number {
  if (decoded.ok) return 1_000_000 + bits.length;
  if (findSyncIndex(bits) >= 0) {
    if (decoded.reason.startsWith("CRC mismatch")) return 10_000 + bits.length;
    return 1_000 + bits.length;
  }
  return bits.length;
}

export function recoverFrame(hops: readonly SoftHop[]): FrameRecovery {
  const empty: FrameRecovery = {
    bits: [],
    decoded: { ok: false, reason: "No FSK hops yet" },
    hopsPerBit: 0,
    phase: 0,
  };
  if (hops.length < 8) return empty;

  const noiseFloor = estimateNoiseFloor(hops);
  let firstTone = 0;
  while (firstTone < hops.length && decideHop(hops[firstTone], noiseFloor) === null) {
    firstTone += 1;
  }
  const active = firstTone > 0 ? hops.slice(firstTone) : hops;
  if (active.length < 8) return empty;

  let best = empty;
  const periods = bitPeriodCandidates(active);

  const search = (maxDistance: number): FrameRecovery | null => {
    let found: FrameRecovery | null = null;
    for (const bitHops of periods) {
      const phaseLimit = Math.max(1, Math.round(bitHops));
      for (let phase = 0; phase < phaseLimit; phase += 1) {
        const bits = bitsForTiming(active, phase, bitHops, noiseFloor);
        if (bits.length < 16) continue;
        const decoded = decodeFramedBits(bits, maxDistance);
        const score = scoreRecovery(bits, decoded);
        if (score > scoreRecovery(best.bits, best.decoded)) {
          best = { bits, decoded, hopsPerBit: bitHops, phase };
        }
        if (decoded.ok && (!found || bits.length > found.bits.length)) {
          found = { bits, decoded, hopsPerBit: bitHops, phase };
        }
      }
    }
    return found;
  };

  return search(0) ?? search(1) ?? best;
}

export function compareBits(got: readonly Bit[], expected: readonly Bit[]): BitCompare {
  let best: BitCompare = { offset: 0, matches: 0, compared: 0 };
  if (got.length === 0 || expected.length === 0) return best;

  for (let offset = -expected.length; offset <= got.length; offset += 1) {
    let matches = 0;
    let compared = 0;
    for (let i = 0; i < expected.length; i += 1) {
      const j = i + offset;
      if (j < 0 || j >= got.length) continue;
      compared += 1;
      if (got[j] === expected[i]) matches += 1;
    }
    if (compared > 0 && (matches > best.matches || (matches === best.matches && compared > best.compared))) {
      best = { offset, matches, compared };
    }
  }
  return best;
}
