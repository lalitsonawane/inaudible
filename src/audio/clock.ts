import { BIT_DURATION_MS } from "./constants";
import { majorityBit } from "./classify";
import type { Bit } from "./protocol";

export const SAMPLE_PHASE = 0.5;
export const SILENCE_FLUSH_MS = BIT_DURATION_MS * 2.5;

export class BitSlicer {
  bits: Bit[] = [];
  private lastDecision: Bit | null = null;
  private lastToneAt = 0;
  private nextSampleAt = 0;
  private armed = false;
  private sampledCurrent = false;
  private votes: Bit[] = [];

  reset(): void {
    this.bits = [];
    this.lastDecision = null;
    this.lastToneAt = 0;
    this.nextSampleAt = 0;
    this.armed = false;
    this.sampledCurrent = false;
    this.votes = [];
  }

  get locked(): boolean {
    return this.armed;
  }

  push(now: number, decision: Bit | null): Bit[] {
    const emitted: Bit[] = [];

    if (decision === null) {
      if (this.armed && now - this.lastToneAt >= SILENCE_FLUSH_MS) {
        this.finishCurrentSymbol(emitted);
        this.armed = false;
        this.lastDecision = null;
        this.votes = [];
      }
      return emitted;
    }

    this.lastToneAt = now;

    if (!this.armed || this.lastDecision === null) {
      this.armed = true;
      this.lastDecision = decision;
      this.sampledCurrent = false;
      this.votes = [decision];
      this.nextSampleAt = now + BIT_DURATION_MS * SAMPLE_PHASE;
      return emitted;
    }

    if (decision !== this.lastDecision) {
      this.finishCurrentSymbol(emitted);
      this.lastDecision = decision;
      this.sampledCurrent = false;
      this.votes = [decision];
      this.nextSampleAt = now + BIT_DURATION_MS * SAMPLE_PHASE;
      return emitted;
    }

    this.votes.push(decision);
    while (now >= this.nextSampleAt) {
      this.emitCurrent(emitted);
      this.nextSampleAt += BIT_DURATION_MS;
    }
    return emitted;
  }

  private finishCurrentSymbol(emitted: Bit[]): void {
    if (!this.sampledCurrent && this.lastDecision !== null) {
      this.emitCurrent(emitted);
    }
  }

  private emitCurrent(emitted: Bit[]): void {
    const bit = majorityBit(this.votes) ?? this.lastDecision;
    if (bit === null) return;
    emitted.push(bit);
    this.bits.push(bit);
    this.sampledCurrent = true;
    this.votes = [];
  }
}

/** Production bug: sample on first detection, then every 0.85 symbols with no transition lock. */
export function sampleFixedInterval(
  samples: ReadonlyArray<{ now: number; decision: Bit | null }>,
  bitDurationMs = BIT_DURATION_MS,
  intervalRatio = 0.85,
): Bit[] {
  const bits: Bit[] = [];
  let lastDecision: Bit | null = null;
  let lastDecisionAt = 0;

  for (const sample of samples) {
    if (sample.decision === null) continue;
    if (lastDecision === null || sample.now - lastDecisionAt >= bitDurationMs * intervalRatio) {
      bits.push(sample.decision);
      lastDecision = sample.decision;
      lastDecisionAt = sample.now;
    }
  }

  return bits;
}

export function decisionsFromBits(
  bits: readonly Bit[],
  options: {
    tickMs?: number;
    bitDurationMs?: number;
    detectDelayMs?: number;
    smearMs?: number;
  } = {},
): Array<{ now: number; decision: Bit | null }> {
  const tickMs = options.tickMs ?? 16;
  const bitDurationMs = options.bitDurationMs ?? BIT_DURATION_MS;
  const detectDelayMs = options.detectDelayMs ?? 12;
  const smearMs = options.smearMs ?? 20;
  const total = bits.length * bitDurationMs + detectDelayMs + 80;
  const samples: Array<{ now: number; decision: Bit | null }> = [];

  for (let now = 0; now <= total; now += tickMs) {
    const t = now - detectDelayMs;
    if (t < 0 || t >= bits.length * bitDurationMs) {
      samples.push({ now, decision: null });
      continue;
    }
    const index = Math.min(bits.length - 1, Math.floor(t / bitDurationMs));
    const intoBit = t - index * bitDurationMs;
    if (intoBit < smearMs && index > 0 && bits[index] !== bits[index - 1]) {
      samples.push({ now, decision: null });
      continue;
    }
    samples.push({ now, decision: bits[index] });
  }

  return samples;
}
