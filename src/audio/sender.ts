import { BIT_DURATION_MS, TRANSMIT_GAIN, frequenciesFor, type Band } from "./constants";
import type { Bit } from "./protocol";

const RAMP_MS = 6;

export async function transmitBits(
  bits: readonly Bit[],
  band: Band,
  context: AudioContext,
): Promise<void> {
  if (bits.length === 0) return;
  if (context.state === "suspended") {
    await context.resume();
  }

  const { freq0, freq1 } = frequenciesFor(band);
  const bitDuration = BIT_DURATION_MS / 1000;
  const ramp = Math.min(RAMP_MS / 1000, bitDuration / 4);
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.connect(gain);
  gain.connect(context.destination);

  const startAt = context.currentTime + 0.05;
  oscillator.frequency.setValueAtTime(bits[0] === 1 ? freq1 : freq0, startAt);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(TRANSMIT_GAIN, startAt + ramp);

  bits.forEach((bit, index) => {
    const t = startAt + index * bitDuration;
    oscillator.frequency.setValueAtTime(bit === 1 ? freq1 : freq0, t);
  });

  const endAt = startAt + bits.length * bitDuration;
  gain.gain.setValueAtTime(TRANSMIT_GAIN, endAt - ramp);
  gain.gain.linearRampToValueAtTime(0, endAt);

  oscillator.start(startAt);
  oscillator.stop(endAt + 0.01);

  await new Promise<void>((resolve, reject) => {
    oscillator.onended = () => resolve();
    oscillator.addEventListener("error", () => reject(new Error("Oscillator failed")));
  });
}
