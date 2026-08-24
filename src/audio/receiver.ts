import {
  ANALYSER_SMOOTHING,
  BIT_DURATION_MS,
  FFT_SIZE,
  MIN_TONE_DB,
  PEAK_NEIGHBOR_BINS,
  SNR_RATIO,
  frequenciesFor,
  type Band,
} from "./constants";
import { decodeFramedBits, type Bit, type DecodeResult } from "./protocol";

export interface SpectrumSample {
  freq0: number;
  freq1: number;
  energy0: number;
  energy1: number;
  decision: Bit | null;
}

export interface ReceiverHandlers {
  onSpectrum?: (sample: SpectrumSample) => void;
  onBits?: (bits: Bit[]) => void;
  onDecode?: (result: DecodeResult) => void;
  onStatus?: (status: string) => void;
  onError?: (error: Error) => void;
}

interface ActiveSession {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  timer: number;
  bits: Bit[];
  lastDecision: Bit | null;
  lastDecisionAt: number;
}

function binForFrequency(frequency: number, sampleRate: number, fftSize: number): number {
  return Math.round((frequency * fftSize) / sampleRate);
}

function bandEnergy(db: Float32Array, centerBin: number, neighbors: number): number {
  let sum = 0;
  let count = 0;
  for (let i = centerBin - neighbors; i <= centerBin + neighbors; i += 1) {
    if (i >= 0 && i < db.length) {
      sum += db[i];
      count += 1;
    }
  }
  return count === 0 ? MIN_TONE_DB : sum / count;
}

function decideBit(energy0: number, energy1: number): Bit | null {
  const louder = Math.max(energy0, energy1);
  if (louder < MIN_TONE_DB) return null;
  const p0 = 10 ** (energy0 / 10);
  const p1 = 10 ** (energy1 / 10);
  const peak = Math.max(p0, p1);
  const other = Math.min(p0, p1);
  if (other <= 0 || peak / other < SNR_RATIO) return null;
  return p1 > p0 ? 1 : 0;
}

export class FskReceiver {
  private session: ActiveSession | null = null;
  private band: Band = "ultrasonic";

  constructor(private readonly context: AudioContext, private readonly handlers: ReceiverHandlers) {}

  get listening(): boolean {
    return this.session !== null;
  }

  setBand(band: Band): void {
    this.band = band;
    if (this.session) {
      this.session.bits = [];
      this.session.lastDecision = null;
    }
  }

  async start(): Promise<void> {
    if (this.session) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone API is not available in this browser");
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const source = this.context.createMediaStreamSource(stream);
    const analyser = this.context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -20;
    source.connect(analyser);

    const session: ActiveSession = {
      stream,
      source,
      analyser,
      timer: 0,
      bits: [],
      lastDecision: null,
      lastDecisionAt: 0,
    };
    this.session = session;
    this.handlers.onStatus?.("Listening for FSK tones");
    session.timer = window.setInterval(() => this.tick(session), 16);
  }

  stop(): void {
    const session = this.session;
    if (!session) return;
    window.clearInterval(session.timer);
    session.source.disconnect();
    session.stream.getTracks().forEach((track) => track.stop());
    this.session = null;
    this.handlers.onStatus?.("Microphone closed");
  }

  resetBits(): void {
    if (this.session) {
      this.session.bits = [];
      this.session.lastDecision = null;
      this.handlers.onBits?.([]);
    }
  }

  private tick(session: ActiveSession): void {
    const { freq0, freq1 } = frequenciesFor(this.band);
    const bins = new Float32Array(session.analyser.frequencyBinCount);
    session.analyser.getFloatFrequencyData(bins);

    const bin0 = binForFrequency(freq0, this.context.sampleRate, session.analyser.fftSize);
    const bin1 = binForFrequency(freq1, this.context.sampleRate, session.analyser.fftSize);
    const energy0 = bandEnergy(bins, bin0, PEAK_NEIGHBOR_BINS);
    const energy1 = bandEnergy(bins, bin1, PEAK_NEIGHBOR_BINS);
    const decision = decideBit(energy0, energy1);

    this.handlers.onSpectrum?.({ freq0, freq1, energy0, energy1, decision });

    const now = performance.now();
    if (decision === null) {
      if (session.lastDecision !== null && now - session.lastDecisionAt > BIT_DURATION_MS * 3) {
        this.tryDecode(session);
        session.lastDecision = null;
      }
      return;
    }

    if (
      session.lastDecision === null ||
      now - session.lastDecisionAt >= BIT_DURATION_MS * 0.85
    ) {
      session.bits.push(decision);
      session.lastDecision = decision;
      session.lastDecisionAt = now;
      this.handlers.onBits?.([...session.bits]);
      this.tryDecode(session);
    }
  }

  private tryDecode(session: ActiveSession): void {
    const result = decodeFramedBits(session.bits);
    if (result.ok) {
      this.handlers.onDecode?.(result);
      this.handlers.onStatus?.("Decoded a frame");
      session.bits = [];
      session.lastDecision = null;
      this.handlers.onBits?.([]);
      return;
    }
    if (result.reason.startsWith("CRC mismatch")) {
      this.handlers.onDecode?.(result);
    }
  }
}
