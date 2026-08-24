import { BIT_DURATION_MS, MIN_TONE_DB, SNR_RATIO, TARGET_SAMPLE_RATE } from "./constants";
import { decideBit } from "./classify";
import type { Bit } from "./protocol";

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

export function classifyWindow(
  samples: ArrayLike<number>,
  freq0: number,
  freq1: number,
  sampleRate = TARGET_SAMPLE_RATE,
): Bit | null {
  const p0 = goertzelPower(samples, freq0, sampleRate);
  const p1 = goertzelPower(samples, freq1, sampleRate);
  if (p0 <= 0 && p1 <= 0) return null;
  const db0 = p0 <= 0 ? MIN_TONE_DB : 10 * Math.log10(p0);
  const db1 = p1 <= 0 ? MIN_TONE_DB : 10 * Math.log10(p1);
  const peak = Math.max(p0, p1);
  const other = Math.min(p0, p1);
  if (other > 0 && peak / other < SNR_RATIO) return null;
  return decideBit(db0, db1);
}

export function scanDecisions(
  audio: Float32Array,
  freq0: number,
  freq1: number,
  sampleRate = TARGET_SAMPLE_RATE,
  windowSamples = 2048,
  hopSamples = 768,
): Array<{ now: number; decision: Bit | null }> {
  const samples: Array<{ now: number; decision: Bit | null }> = [];
  for (let start = 0; start + windowSamples <= audio.length; start += hopSamples) {
    const window = audio.subarray(start, start + windowSamples);
    const now = (start / sampleRate) * 1000;
    samples.push({
      now,
      decision: classifyWindow(window, freq0, freq1, sampleRate),
    });
  }
  return samples;
}
