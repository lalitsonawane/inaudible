import { describe, expect, it } from "vitest";
import { ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1 } from "./constants";
import { recoverFrame } from "./demod";
import { classifyWindow, scanHops, synthesizeFsk } from "./dsp";
import { encodeMessage } from "./protocol";

describe("PCM FSK loopback", () => {
  it("classifies a pure ultrasonic mark and space", () => {
    const space = synthesizeFsk([0], ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1);
    const mark = synthesizeFsk([1], ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1);
    expect(classifyWindow(space, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1)).toBe(0);
    expect(classifyWindow(mark, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1)).toBe(1);
  });

  it("decodes a synthesized inaudible frame with the shared demodulator", () => {
    const bits = encodeMessage("hello fsk");
    const audio = synthesizeFsk(bits, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1);
    const recovered = recoverFrame(scanHops(audio, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1));
    expect(recovered.decoded.ok).toBe(true);
    if (recovered.decoded.ok) {
      expect(recovered.decoded.text).toBe("hello fsk");
    }
  });
});
