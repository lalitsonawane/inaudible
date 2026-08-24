export const ULTRASONIC_FREQ_0 = 18_500;
export const ULTRASONIC_FREQ_1 = 19_500;

/** Audible fallback so a single-device demo still works when speakers roll off above ~16 kHz. */
export const AUDIBLE_FREQ_0 = 1_800;
export const AUDIBLE_FREQ_1 = 2_800;

export const BIT_DURATION_MS = 70;
export const MAX_PAYLOAD_BYTES = 48;
export const FFT_SIZE = 4096;
export const ANALYSER_SMOOTHING = 0.15;
export const PEAK_NEIGHBOR_BINS = 3;
export const SNR_RATIO = 1.35;
export const MIN_TONE_DB = -72;

export const PREAMBLE_BITS = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0] as const;
export const SYNC_BITS = [0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 1] as const;

export type Band = "ultrasonic" | "audible";

export interface BandConfig {
  id: Band;
  label: string;
  freq0: number;
  freq1: number;
  spectrumMin: number;
  spectrumMax: number;
}

export const BANDS: Record<Band, BandConfig> = {
  ultrasonic: {
    id: "ultrasonic",
    label: "Ultrasonic 18.5 / 19.5 kHz",
    freq0: ULTRASONIC_FREQ_0,
    freq1: ULTRASONIC_FREQ_1,
    spectrumMin: 16_000,
    spectrumMax: 21_000,
  },
  audible: {
    id: "audible",
    label: "Audible demo 1.8 / 2.8 kHz",
    freq0: AUDIBLE_FREQ_0,
    freq1: AUDIBLE_FREQ_1,
    spectrumMin: 500,
    spectrumMax: 4_000,
  },
};

export function frequenciesFor(band: Band): { freq0: number; freq1: number } {
  const config = BANDS[band];
  return { freq0: config.freq0, freq1: config.freq1 };
}
