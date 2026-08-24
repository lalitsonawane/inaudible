import {
  ANALYSER_SMOOTHING,
  FFT_SIZE,
  PEAK_NEIGHBOR_BINS,
  SYNC_BITS,
  TARGET_SAMPLE_RATE,
  frequenciesFor,
  type Band,
} from "./constants";
import { bandEnergy, binForFrequency, decideBit } from "./classify";
import { BitSlicer } from "./clock";
import { decodeFramedBits, findSyncIndex, type Bit, type DecodeResult } from "./protocol";

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
  raf: number;
  slicer: BitSlicer;
}

function microphoneConstraints(): MediaTrackConstraints {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: TARGET_SAMPLE_RATE,
  };
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
    this.session?.slicer.reset();
    this.handlers.onBits?.([]);
  }

  async start(): Promise<void> {
    if (this.session) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone API is not available in this browser");
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints() });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    }

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
      raf: 0,
      slicer: new BitSlicer(),
    };
    this.session = session;
    this.handlers.onStatus?.("Listening for FSK tones");

    const loop = (): void => {
      if (this.session !== session) return;
      this.tick(session);
      session.raf = requestAnimationFrame(loop);
    };
    session.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    const session = this.session;
    if (!session) return;
    cancelAnimationFrame(session.raf);
    session.source.disconnect();
    session.stream.getTracks().forEach((track) => track.stop());
    this.session = null;
    this.handlers.onStatus?.("Microphone closed");
  }

  resetBits(): void {
    if (!this.session) return;
    this.session.slicer.reset();
    this.handlers.onBits?.([]);
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

    const before = session.slicer.bits.length;
    const lockedBefore = session.slicer.locked;
    session.slicer.push(performance.now(), decision);
    if (session.slicer.bits.length !== before) {
      this.handlers.onBits?.([...session.slicer.bits]);
      this.tryDecode(session);
    } else if (lockedBefore && !session.slicer.locked) {
      this.tryDecode(session);
    }
  }

  private tryDecode(session: ActiveSession): void {
    const result = decodeFramedBits(session.slicer.bits);
    if (result.ok) {
      this.handlers.onDecode?.(result);
      this.handlers.onStatus?.("Decoded a frame");
      session.slicer.reset();
      this.handlers.onBits?.([]);
      return;
    }
    if (result.reason.startsWith("CRC mismatch")) {
      this.handlers.onDecode?.(result);
      const syncIndex = findSyncIndex(session.slicer.bits);
      if (syncIndex >= 0) {
        session.slicer.bits = session.slicer.bits.slice(syncIndex + SYNC_BITS.length);
        this.handlers.onBits?.([...session.slicer.bits]);
      }
    }
  }
}
