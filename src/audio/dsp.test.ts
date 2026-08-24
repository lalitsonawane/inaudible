import { describe, expect, it } from "vitest";
import { BitSlicer } from "./clock";
import { ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1 } from "./constants";
import { classifyWindow, scanDecisions, synthesizeFsk } from "./dsp";
import { decodeFramedBits, encodeMessage } from "./protocol";

describe("PCM FSK loopback", () => {
  it("classifies a pure ultrasonic mark and space", () => {
    const space = synthesizeFsk([0], ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1);
    const mark = synthesizeFsk([1], ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1);
    expect(classifyWindow(space, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1)).toBe(0);
    expect(classifyWindow(mark, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1)).toBe(1);
  });

  it("decodes a synthesized inaudible frame", () => {
    const framed = encodeMessage("hello fsk");
    const audio = synthesizeFsk(framed, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1);
    const slicer = new BitSlicer();
    for (const sample of scanDecisions(audio, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1)) {
      slicer.push(sample.now, sample.decision);
    }
    slicer.push((audio.length / 48_000) * 1000 + 400, null);
    const decoded = decodeFramedBits(slicer.bits);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.text).toBe("hello fsk");
    }
  });
});
