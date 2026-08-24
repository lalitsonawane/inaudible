import { HOP_SAMPLES, TARGET_SAMPLE_RATE, frequenciesFor, type Band } from "./constants";
import { BurstCollector } from "./burst";
import { attachPcmTap } from "./capture";
import { recoverFrame } from "./demod";
import { HopScanner, hopPowerDb, type SoftHop } from "./dsp";
import type { Bit, DecodeResult } from "./protocol";

export type ListenPhase = "quiet" | "collecting" | "decoded";

export interface SpectrumSample {
  freq0: number;
  freq1: number;
  energy0: number;
  energy1: number;
  decision: Bit | null;
  sampleRate: number;
  hops: number;
  phase: ListenPhase;
  phaseText: string;
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
  burst: BurstCollector;
  hopsSincePreview: number;
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

function displayLevel(power: number, noisePeak: number): number {
  return Math.min(0, hopPowerDb(power) - hopPowerDb(Math.max(noisePeak, 1e-12)) - 8);
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
    const session: ActiveSession = {
      stream,
      source,
      disposeTap: () => undefined,
      scanner: new HopScanner(),
      burst: new BurstCollector(),
      hopsSincePreview: 0,
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
      this.handlers.onStatus?.(
        `Listening at ${Math.round(this.context.sampleRate)} Hz. Waiting for an FSK tone — mixed bits will stay empty until then.`,
      );
    }
    this.handlers.onBits?.([]);
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
    if (this.session) {
      this.session.scanner.reset();
      this.session.burst.reset();
      this.session.hopsSincePreview = 0;
    }
    this.handlers.onBits?.([]);
  }

  private ingest(session: ActiveSession, chunk: Float32Array): void {
    const { freq0, freq1 } = frequenciesFor(this.band);
    const next = session.scanner.push(chunk, freq0, freq1, this.context.sampleRate);
    if (next.length === 0) return;

    let lastReading = { tone: false, decision: null as Bit | null, peak: 0, snr: 0 };
    let lastHop = next[next.length - 1];
    let flushed: SoftHop[] | null = null;

    for (const hop of next) {
      lastHop = hop;
      const result = session.burst.push(hop);
      lastReading = result.reading;
      if (result.event === "collecting") {
        session.hopsSincePreview += 1;
        if (session.hopsSincePreview >= 12 && session.burst.hops.length >= 40) {
          session.hopsSincePreview = 0;
          this.preview(session.burst.hops);
        }
      }
      if (result.event === "flush") {
        flushed = session.burst.takeBurst();
      }
    }

    const phase: ListenPhase = flushed ? "quiet" : session.burst.hops.length > 0 ? "collecting" : "quiet";
    const seconds = (session.burst.hops.length * HOP_SAMPLES) / this.context.sampleRate;
    const phaseText =
      phase === "collecting"
        ? `Hearing an FSK tone (${seconds.toFixed(1)} s). Not a decoded message yet.`
        : "Listening. No FSK tone — the mic is not hearing a clear 0/1 carrier.";

    this.handlers.onSpectrum?.({
      freq0,
      freq1,
      energy0: displayLevel(lastHop.p0, session.burst.noisePeak),
      energy1: displayLevel(lastHop.p1, session.burst.noisePeak),
      decision: lastReading.decision,
      sampleRate: this.context.sampleRate,
      hops: session.burst.hops.length,
      phase,
      phaseText,
    });

    if (flushed) {
      this.finishBurst(flushed);
    }
  }

  private preview(hops: SoftHop[]): void {
    const recovered = recoverFrame(hops);
    if (recovered.bits.length === 0) return;
    this.handlers.onBits?.([...recovered.bits]);
    if (recovered.decoded.ok) {
      this.handlers.onDecode?.(recovered.decoded);
      this.handlers.onStatus?.(`Decoded a frame while the tone was still playing`);
      this.resetBits();
    }
  }

  private finishBurst(hops: SoftHop[]): void {
    if (hops.length < 20) {
      this.handlers.onBits?.([]);
      this.handlers.onStatus?.("Tone ended too quickly to be a message. Still listening.");
      return;
    }
    const recovered = recoverFrame(hops);
    this.handlers.onBits?.([...recovered.bits]);
    if (recovered.decoded.ok) {
      this.handlers.onDecode?.(recovered.decoded);
      this.handlers.onStatus?.(`Decoded a frame (${recovered.hopsPerBit.toFixed(1)} hops/bit)`);
      return;
    }
    if (recovered.decoded.reason.startsWith("CRC mismatch")) {
      this.handlers.onDecode?.(recovered.decoded);
      this.handlers.onStatus?.(
        "Heard a frame-like burst but the bits were damaged. Try closer, louder, or the audible band.",
      );
      return;
    }
    this.handlers.onStatus?.(
      "Heard a tone burst that did not turn into a message. Those Live bits are a guess, not a decode.",
    );
  }
}
