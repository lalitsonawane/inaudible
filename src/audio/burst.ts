import { SNR_RATIO } from "./constants";
import { type SoftHop } from "./dsp";
import type { Bit } from "./protocol";

export const WARMUP_HOPS = 12;
export const SILENCE_FLUSH_HOPS = 24;
export const MAX_BURST_HOPS = 1400;

export type BurstEvent = "quiet" | "collecting" | "flush";

export interface ToneReading {
  tone: boolean;
  decision: Bit | null;
  peak: number;
  snr: number;
}

export function toneFromHop(hop: SoftHop, noisePeak: number, noiseEnergy: number): ToneReading {
  const peak = Math.max(hop.p0, hop.p1);
  const other = Math.min(hop.p0, hop.p1);
  const snr = other > 0 ? peak / other : peak > 0 ? Number.POSITIVE_INFINITY : 0;
  const tone =
    peak > Math.max(1e-9, noisePeak * 12) && hop.energy > Math.max(3e-5, noiseEnergy * 5) && snr >= SNR_RATIO;
  return {
    tone,
    decision: tone ? (hop.p1 > hop.p0 ? 1 : 0) : null,
    peak,
    snr,
  };
}

export class BurstCollector {
  hops: SoftHop[] = [];
  noisePeak = 1e-8;
  noiseEnergy = 1e-5;
  private warmed = 0;
  private quiet = 0;

  reset(): void {
    this.hops = [];
    this.warmed = 0;
    this.quiet = 0;
  }

  push(hop: SoftHop): { event: BurstEvent; reading: ToneReading } {
    const reading = toneFromHop(hop, this.noisePeak, this.noiseEnergy);

    if (this.warmed < WARMUP_HOPS) {
      this.warmed += 1;
      this.learnNoise(hop, reading.peak);
      return { event: "quiet", reading: { ...reading, tone: false, decision: null } };
    }

    if (!reading.tone) {
      this.learnNoise(hop, reading.peak);
      this.quiet += 1;
      if (this.hops.length > 0 && this.quiet >= SILENCE_FLUSH_HOPS) {
        const event: BurstEvent = "flush";
        return { event, reading };
      }
      return { event: this.hops.length > 0 ? "collecting" : "quiet", reading };
    }

    this.quiet = 0;
    this.hops.push(hop);
    if (this.hops.length > MAX_BURST_HOPS) {
      this.hops.splice(0, this.hops.length - MAX_BURST_HOPS);
    }
    return { event: "collecting", reading };
  }

  takeBurst(): SoftHop[] {
    const hops = this.hops;
    this.hops = [];
    this.quiet = 0;
    return hops;
  }

  private learnNoise(hop: SoftHop, peak: number): void {
    this.noisePeak = this.noisePeak * 0.95 + peak * 0.05;
    this.noiseEnergy = this.noiseEnergy * 0.95 + hop.energy * 0.05;
  }
}
