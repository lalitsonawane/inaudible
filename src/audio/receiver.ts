import { TARGET_SAMPLE_RATE, frequenciesFor, type Band } from "./constants";
import { attachPcmTap } from "./capture";
import { recoverFrame } from "./demod";
import { HopScanner, hopPowerDb, type SoftHop } from "./dsp";
import { findSyncIndex, type Bit, type DecodeResult } from "./protocol";

export interface SpectrumSample {
  freq0: number;
  freq1: number;
  energy0: number;
  energy1: number;
  decision: Bit | null;
  sampleRate: number;
  hops: number;
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
  disposeTap: () => void;
  scanner: HopScanner;
  hops: SoftHop[];
  lastCrcBits: number;
}

function microphoneConstraints(): MediaTrackConstraints {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: { ideal: TARGET_SAMPLE_RATE },
    voiceIsolation: false,
  } as MediaTrackConstraints;
}

export class FskReceiver {
  private session: ActiveSession | null = null;
  private band: Band = "ultrasonic";

  constructor(private readonly context: AudioContext, private readonly handlers: ReceiverHandlers) {}

  get listening(): boolean {
    return this.session !== null;
  }

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  setBand(band: Band): void {
    this.band = band;
    this.resetBits();
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
    const scanner = new HopScanner();
    const hops: SoftHop[] = [];
    const session: ActiveSession = {
      stream,
      source,
      disposeTap: () => undefined,
      scanner,
      hops,
      lastCrcBits: -1,
    };

    session.disposeTap = await attachPcmTap(this.context, source, (chunk) => {
      if (this.session !== session) return;
      this.ingest(session, chunk);
    });

    this.session = session;
    const trackRate = stream.getAudioTracks()[0]?.getSettings().sampleRate;
    const rate = trackRate || this.context.sampleRate;
    if (rate < 40_000 && this.band === "ultrasonic") {
      this.handlers.onStatus?.(
        `Listening at ${Math.round(rate)} Hz — too low for ultrasonic. Switch to the audible band.`,
      );
    } else {
      this.handlers.onStatus?.(`Listening with Goertzel hops at ${Math.round(this.context.sampleRate)} Hz`);
    }
  }

  stop(): void {
    const session = this.session;
    if (!session) return;
    session.disposeTap();
    session.source.disconnect();
    session.stream.getTracks().forEach((track) => track.stop());
    this.session = null;
    this.handlers.onStatus?.("Microphone closed");
  }

  resetBits(): void {
    if (!this.session) {
      this.handlers.onBits?.([]);
      return;
    }
    this.session.scanner.reset();
    this.session.hops = [];
    this.session.lastCrcBits = -1;
    this.handlers.onBits?.([]);
  }

  private ingest(session: ActiveSession, chunk: Float32Array): void {
    const { freq0, freq1 } = frequenciesFor(this.band);
    const next = session.scanner.push(chunk, freq0, freq1, this.context.sampleRate);
    if (next.length === 0) return;

    session.hops.push(...next);
    if (session.hops.length > 2000) {
      session.hops.splice(0, session.hops.length - 2000);
    }

    const hop = next[next.length - 1];
    const total = hop.p0 + hop.p1 + 1e-15;
    this.handlers.onSpectrum?.({
      freq0,
      freq1,
      energy0: hopPowerDb(hop.p0 / total),
      energy1: hopPowerDb(hop.p1 / total),
      decision: hop.p1 === hop.p0 ? null : hop.p1 > hop.p0 ? 1 : 0,
      sampleRate: this.context.sampleRate,
      hops: session.hops.length,
    });

    const recovered = recoverFrame(session.hops);
    this.handlers.onBits?.([...recovered.bits]);

    if (recovered.decoded.ok) {
      this.handlers.onDecode?.(recovered.decoded);
      this.handlers.onStatus?.(
        `Decoded a frame (phase ${recovered.phase}, ${recovered.hopsPerBit} hops/bit)`,
      );
      session.scanner.reset();
      session.hops = [];
      session.lastCrcBits = -1;
      return;
    }

    if (
      recovered.decoded.reason.startsWith("CRC mismatch") &&
      recovered.bits.length !== session.lastCrcBits
    ) {
      session.lastCrcBits = recovered.bits.length;
      this.handlers.onDecode?.(recovered.decoded);
      const syncIndex = findSyncIndex(recovered.bits);
      if (syncIndex >= 0 && session.hops.length > 40) {
        session.hops = session.hops.slice(Math.floor(session.hops.length / 3));
      }
    }
  }
}
