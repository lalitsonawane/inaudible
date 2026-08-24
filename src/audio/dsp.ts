import {
  BIT_DURATION_MS,
  HOP_SAMPLES,
  SNR_RATIO,
  TARGET_SAMPLE_RATE,
  WINDOW_SAMPLES,
} from "./constants";
import type { Bit } from "./protocol";

export interface SoftHop {
  now: number;
  p0: number;
  p1: number;
  energy: number;
}

export function synthesizeFsk(
  bits: readonly Bit[],
  freq0: number,
  freq1: number,
  sampleRate = TARGET_SAMPLE_RATE,
  bitDurationMs = BIT_DURATION_MS,
): Float32Array {
  const samplesPerBit = Math.round((sampleRate * bitDurationMs) / 1000);
  const audio = new Float32Array(bits.length * samplesPerBit);
  let phase = 0;

  for (let i = 0; i < bits.length; i += 1) {
    const freq = bits[i] === 1 ? freq1 : freq0;
    const step = (2 * Math.PI * freq) / sampleRate;
    const offset = i * samplesPerBit;
    for (let n = 0; n < samplesPerBit; n += 1) {
      audio[offset + n] = Math.sin(phase);
      phase += step;
    }
  }

  return audio;
}

export function goertzelPower(samples: ArrayLike<number>, frequency: number, sampleRate: number): number {
  const n = samples.length;
  if (n === 0) return 0;
  const k = Math.round((n * frequency) / sampleRate);
  const omega = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i += 1) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

function hannWindow(samples: ArrayLike<number>): Float32Array {
  const n = samples.length;
  const windowed = new Float32Array(n);
  if (n < 2) return windowed;
  for (let i = 0; i < n; i += 1) {
    windowed[i] = samples[i] * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return windowed;
}

function rms(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}

export function analyzeWindow(
  samples: ArrayLike<number>,
  freq0: number,
  freq1: number,
  sampleRate = TARGET_SAMPLE_RATE,
  now = 0,
): SoftHop {
  const windowed = hannWindow(samples);
  return {
    now,
    p0: goertzelPower(windowed, freq0, sampleRate),
    p1: goertzelPower(windowed, freq1, sampleRate),
    energy: rms(samples),
  };
}

export function classifyWindow(
  samples: ArrayLike<number>,
  freq0: number,
  freq1: number,
  sampleRate = TARGET_SAMPLE_RATE,
): Bit | null {
  return decideHop(analyzeWindow(samples, freq0, freq1, sampleRate), 1e-10);
}

export function decideHop(hop: SoftHop, noiseFloor: number): Bit | null {
  const peak = Math.max(hop.p0, hop.p1);
  const other = Math.min(hop.p0, hop.p1);
  if (peak < Math.max(1e-10, noiseFloor * 8)) return null;
  if (other > 0 && peak / other < SNR_RATIO) return null;
  if (hop.energy < 1e-5 && peak < 1e-6) return null;
  return hop.p1 > hop.p0 ? 1 : 0;
}

export function hopPowerDb(power: number): number {
  return 10 * Math.log10(power + 1e-15);
}

export class HopScanner {
  private leftover = new Float32Array(0);
  private samplesSeen = 0;

  reset(): void {
    this.leftover = new Float32Array(0);
    this.samplesSeen = 0;
  }

  push(
    chunk: Float32Array,
    freq0: number,
    freq1: number,
    sampleRate: number,
    windowSamples = WINDOW_SAMPLES,
    hopSamples = HOP_SAMPLES,
  ): SoftHop[] {
    const merged = new Float32Array(this.leftover.length + chunk.length);
    merged.set(this.leftover);
    merged.set(chunk, this.leftover.length);

    const hops: SoftHop[] = [];
    let offset = 0;
    while (offset + windowSamples <= merged.length) {
      const window = merged.subarray(offset, offset + windowSamples);
      const now = ((this.samplesSeen + offset) / sampleRate) * 1000;
      hops.push(analyzeWindow(window, freq0, freq1, sampleRate, now));
      offset += hopSamples;
    }

    this.samplesSeen += offset;
    this.leftover = merged.slice(offset);
    return hops;
  }
}

export function scanHops(
  audio: Float32Array,
  freq0: number,
  freq1: number,
  sampleRate = TARGET_SAMPLE_RATE,
): SoftHop[] {
  const scanner = new HopScanner();
  return scanner.push(audio, freq0, freq1, sampleRate);
}

export function scanDecisions(
  audio: Float32Array,
  freq0: number,
  freq1: number,
  sampleRate = TARGET_SAMPLE_RATE,
): Array<{ now: number; decision: Bit | null }> {
  return scanHops(audio, freq0, freq1, sampleRate).map((hop) => ({
    now: hop.now,
    decision: decideHop(hop, 1e-10),
  }));
}
