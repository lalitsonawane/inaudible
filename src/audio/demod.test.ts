import { describe, expect, it } from "vitest";
import { AUDIBLE_FREQ_0, AUDIBLE_FREQ_1, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1 } from "./constants";
import { compareBits, recoverFrame } from "./demod";
import { scanHops, synthesizeFsk } from "./dsp";
import { encodeMessage, type Bit } from "./protocol";

function recoverText(
  text: string,
  freq0 = ULTRASONIC_FREQ_0,
  freq1 = ULTRASONIC_FREQ_1,
  sampleRate = 48_000,
): string {
  const bits = encodeMessage(text);
  const audio = synthesizeFsk(bits, freq0, freq1, sampleRate);
  const recovered = recoverFrame(scanHops(audio, freq0, freq1, sampleRate));
  if (!recovered.decoded.ok) {
    throw new Error(recovered.decoded.reason);
  }
  return recovered.decoded.text;
}

function concat(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("shared hop demodulator", () => {
  it("decodes a clean ultrasonic frame at 48 kHz", () => {
    expect(recoverText("hello fsk")).toBe("hello fsk");
  });

  it("decodes the same frame at 44.1 kHz", () => {
    expect(recoverText("ping", ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1, 44_100)).toBe("ping");
  });

  it("decodes the audible band", () => {
    expect(recoverText("ok", AUDIBLE_FREQ_0, AUDIBLE_FREQ_1)).toBe("ok");
  });

  it("ignores leading silence and still matches the expected bits", () => {
    const bits = encodeMessage("hello fsk");
    const audio = concat([
      new Float32Array(48_000 * 0.25),
      synthesizeFsk(bits, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1),
      new Float32Array(48_000 * 0.1),
    ]);
    const recovered = recoverFrame(scanHops(audio, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1));
    expect(recovered.decoded.ok).toBe(true);
    if (recovered.decoded.ok) {
      expect(recovered.decoded.text).toBe("hello fsk");
    }
    const compared = compareBits(recovered.bits, bits);
    expect(compared.matches).toBe(compared.compared);
    expect(compared.compared).toBeGreaterThan(100);
  });

  it("decodes a weak noisy ultrasonic take that mimics a microphone", () => {
    const bits = encodeMessage("hello fsk");
    const clean = synthesizeFsk(bits, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1);
    const audio = new Float32Array(clean.length + 6000);
    audio.set(clean, 3000);
    let seed = 0x1a2b3c4d;
    for (let i = 0; i < audio.length; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 0xffffffff * 2 - 1;
      audio[i] = audio[i] * 0.03 + noise * 0.004;
    }
    const recovered = recoverFrame(scanHops(audio, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1));
    expect(recovered.decoded.ok).toBe(true);
    if (recovered.decoded.ok) {
      expect(recovered.decoded.text).toBe("hello fsk");
    }
  });

  it("scores a shifted bit string against the expected frame", () => {
    const expected: Bit[] = [1, 0, 1, 1, 0, 0, 0, 1];
    const got: Bit[] = [0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1];
    const compared = compareBits(got, expected);
    expect(compared.offset).toBe(2);
    expect(compared.matches).toBe(8);
  });
});
