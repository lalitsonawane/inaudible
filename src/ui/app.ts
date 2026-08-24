import { BANDS, MAX_PAYLOAD_BYTES, TARGET_SAMPLE_RATE, type Band } from "../audio/constants";
import { describeCompare, recoverFrame } from "../audio/demod";
import { scanHops, synthesizeFsk } from "../audio/dsp";
import { FskReceiver, type SpectrumSample } from "../audio/receiver";
import { transmitBits } from "../audio/sender";
import {
  encodeMessage,
  formatBitString,
  transmissionDurationMs,
  type Bit,
  type DecodeResult,
} from "../audio/protocol";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function energyWidth(db: number): string {
  const clamped = Math.min(0, Math.max(-100, db));
  return `${((clamped + 100) / 100) * 100}%`;
}

function createAudioContext(): AudioContext {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  try {
    return new Ctor({ sampleRate: TARGET_SAMPLE_RATE, latencyHint: "interactive" });
  } catch {
    return new Ctor();
  }
}

export function mountApp(root: HTMLElement): void {
  const audioContext = createAudioContext();
  let band: Band = "ultrasonic";
  let sending = false;
  let lastExpected: Bit[] = encodeMessage("hello fsk");

  const status = el("p", "status", "Ready. HTTPS or localhost is required for the microphone.");
  const message = el("p", "message", "No frame decoded yet");
  const bitsView = el("p", "bits", "Bits: —");
  const compareView = el("p", "hint", "vs expected: —");
  const duration = el("p", "hint", "");
  const spectrumMeta = el("p", "spectrum-meta", "Spectrum idle");
  const bar0 = el("span");
  const bar1 = el("span");
  const textarea = el("textarea");
  textarea.maxLength = MAX_PAYLOAD_BYTES;
  textarea.placeholder = "Type a short message to modulate";
  textarea.value = "hello fsk";

  const bandSelect = el("select");
  (Object.keys(BANDS) as Band[]).forEach((id) => {
    const option = el("option");
    option.value = id;
    option.textContent = BANDS[id].label;
    bandSelect.append(option);
  });
  bandSelect.value = band;

  const sendButton = el("button", undefined, "Transmit");
  const listenButton = el("button", "secondary", "Start listening");
  const clearButton = el("button", "secondary", "Clear bits");
  const selfTestButton = el("button", "secondary", "Self-test decoder");

  function showBits(bits: Bit[], label = "Guessed bits"): void {
    bitsView.textContent = bits.length
      ? `${label} (${bits.length}): ${formatBitString(bits)}`
      : "Guessed bits: none yet";
    compareView.textContent = describeCompare(bits, lastExpected);
  }

  const receiver = new FskReceiver(audioContext, {
    onStatus: (text) => setStatus(text),
    onError: (error) => setStatus(error.message, true),
    onBits: (bits) => showBits(bits, "Guessed bits"),
    onDecode: (result: DecodeResult) => {
      if (result.ok) {
        message.textContent = result.text;
        setStatus(`Decoded ${result.bytes.length} bytes, CRC ${result.crc}`);
      } else {
        setStatus(result.reason, true);
      }
    },
    onSpectrum: (sample: SpectrumSample) => {
      bar0.style.width = energyWidth(sample.energy0);
      bar1.style.width = energyWidth(sample.energy1);
      const decided = sample.decision === null ? "no clear bit" : `hearing bit ${sample.decision}`;
      spectrumMeta.textContent = `${sample.phaseText} · ${decided} · ${sample.sampleRate} Hz`;
    },
  });

  function setStatus(text: string, isError = false): void {
    status.textContent = text;
    status.classList.toggle("error", isError);
  }

  function refreshDuration(): void {
    try {
      lastExpected = encodeMessage(textarea.value);
      duration.textContent = `${lastExpected.length} bits · ${transmissionDurationMs(lastExpected.length)} ms`;
    } catch (error) {
      duration.textContent = error instanceof Error ? error.message : "Invalid payload";
    }
  }

  function runDecoderSelfTest(): void {
    const bits = encodeMessage(textarea.value);
    lastExpected = bits;
    const { freq0, freq1 } = BANDS[band];
    const rate = audioContext.sampleRate || TARGET_SAMPLE_RATE;
    const audio = synthesizeFsk(bits, freq0, freq1, rate);
    const recovered = recoverFrame(scanHops(audio, freq0, freq1, rate));
    showBits(recovered.bits, "Self-test bits");
    if (recovered.decoded.ok) {
      message.textContent = recovered.decoded.text;
      setStatus(
        `Self-test decoded ${recovered.decoded.bytes.length} bytes on ${BANDS[band].label} (${recovered.hopsPerBit} hops/bit)`,
      );
    } else {
      message.textContent = "Self-test failed";
      setStatus(recovered.decoded.reason, true);
    }
  }

  bandSelect.addEventListener("change", () => {
    band = bandSelect.value as Band;
    receiver.setBand(band);
    setStatus(`Band set to ${BANDS[band].label}`);
  });

  textarea.addEventListener("input", refreshDuration);

  sendButton.addEventListener("click", async () => {
    if (sending) return;
    sending = true;
    sendButton.disabled = true;
    try {
      lastExpected = encodeMessage(textarea.value);
      receiver.resetBits();
      setStatus(`Transmitting ${lastExpected.length} bits on ${BANDS[band].label}`);
      await transmitBits(lastExpected, band, audioContext);
      setStatus("Transmission complete");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Transmit failed", true);
    } finally {
      sending = false;
      sendButton.disabled = false;
    }
  });

  listenButton.addEventListener("click", async () => {
    try {
      if (receiver.listening) {
        receiver.stop();
        listenButton.textContent = "Start listening";
        return;
      }
      await receiver.start();
      listenButton.textContent = "Stop listening";
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Microphone failed", true);
    }
  });

  clearButton.addEventListener("click", () => {
    receiver.resetBits();
    message.textContent = "No frame decoded yet";
    showBits([]);
    setStatus("Bit buffer cleared");
  });

  selfTestButton.addEventListener("click", () => {
    try {
      runDecoderSelfTest();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Self-test failed", true);
    }
  });

  const hero = el("header", "hero");
  hero.append(
    el("p", "eyebrow", "Web Audio proof of concept"),
    el("h1", undefined, "Inaudible FSK link"),
    el(
      "p",
      "lede",
      "Start listening on the receiver, then transmit. Self-test proves the decoder on clean audio. Live bits only appear when the microphone hears a real FSK tone — a churning wall of 0s and 1s was just noise.",
    ),
  );

  const sendPanel = el("section", "panel");
  sendPanel.append(
    el("h2", undefined, "Sender"),
    el("p", "hint", "0 = lower carrier, 1 = higher carrier. Frames include preamble, sync, length, payload, and CRC-8."),
    bandSelect,
    textarea,
    duration,
  );
  const sendRow = el("div", "row");
  sendRow.append(sendButton);
  sendPanel.append(sendRow);

  const receivePanel = el("section", "panel");
  const spectrum = el("div", "spectrum");
  const wrap0 = el("div", "bar");
  const wrap1 = el("div", "bar mark1");
  wrap0.append(bar0);
  wrap1.append(bar1);
  spectrum.append(wrap0, wrap1);
  const receiveRow = el("div", "row");
  receiveRow.append(listenButton, clearButton, selfTestButton);
  receivePanel.append(
    el("h2", undefined, "Receiver"),
    el("p", "hint", "The two bars are the 0 and 1 carriers. Guessed bits are not the message until the green line shows decoded text. A ~50–70% match means random noise, not a lock."),
    receiveRow,
    spectrum,
    spectrumMeta,
    bitsView,
    compareView,
    message,
    status,
  );

  const grid = el("div", "grid");
  grid.append(sendPanel, receivePanel);
  root.append(hero, grid);
  refreshDuration();
}
