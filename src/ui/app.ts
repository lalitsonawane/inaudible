import { BANDS, MAX_PAYLOAD_BYTES, type Band } from "../audio/constants";
import { FskReceiver, type SpectrumSample } from "../audio/receiver";
import { transmitBits } from "../audio/sender";
import {
  encodeMessage,
  formatBitString,
  transmissionDurationMs,
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

export function mountApp(root: HTMLElement): void {
  const audioContext = new AudioContext();
  let band: Band = "ultrasonic";
  let sending = false;

  const status = el("p", "status", "Ready. HTTPS or localhost is required for the microphone.");
  const message = el("p", "message", "No frame decoded yet");
  const bitsView = el("p", "bits", "Bits: —");
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

  const receiver = new FskReceiver(audioContext, {
    onStatus: (text) => setStatus(text),
    onError: (error) => setStatus(error.message, true),
    onBits: (bits) => {
      bitsView.textContent = bits.length
        ? `Bits (${bits.length}): ${formatBitString(bits)}`
        : "Bits: —";
    },
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
      const decided = sample.decision === null ? "silence" : `bit ${sample.decision}`;
      spectrumMeta.textContent = `${sample.freq0} Hz ${sample.energy0.toFixed(1)} dB · ${sample.freq1} Hz ${sample.energy1.toFixed(1)} dB · ${decided}`;
    },
  });

  function setStatus(text: string, isError = false): void {
    status.textContent = text;
    status.classList.toggle("error", isError);
  }

  function refreshDuration(): void {
    try {
      const bits = encodeMessage(textarea.value);
      duration.textContent = `${bits.length} bits · ${transmissionDurationMs(bits.length)} ms`;
    } catch (error) {
      duration.textContent = error instanceof Error ? error.message : "Invalid payload";
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
      const bits = encodeMessage(textarea.value);
      setStatus(`Transmitting ${bits.length} bits on ${BANDS[band].label}`);
      await transmitBits(bits, band, audioContext);
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
    setStatus("Bit buffer cleared");
  });

  const hero = el("header", "hero");
  hero.append(
    el("p", "eyebrow", "Web Audio proof of concept"),
    el("h1", undefined, "Inaudible FSK link"),
    el("p", "lede", "Send and receive short messages with OscillatorNode FSK and AnalyserNode FFT. Use ultrasonic tones on two devices, or the audible band for a single-device demo."),
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
  receiveRow.append(listenButton, clearButton);
  receivePanel.append(
    el("h2", undefined, "Receiver"),
    el("p", "hint", "Allow microphone access, then listen on the same band as the sender."),
    receiveRow,
    spectrum,
    spectrumMeta,
    bitsView,
    message,
    status,
  );

  const grid = el("div", "grid");
  grid.append(sendPanel, receivePanel);
  root.append(hero, grid);
  refreshDuration();
}
