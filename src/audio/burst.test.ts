import { describe, expect, it } from "vitest";
import { BurstCollector, toneFromHop } from "./burst";
import { ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1 } from "./constants";
import { analyzeWindow, synthesizeFsk } from "./dsp";

describe("tone burst gating", () => {
  it("treats quiet noise as not a tone", () => {
    const noise = new Float32Array(2048);
    for (let i = 0; i < noise.length; i += 1) noise[i] = ((i * 17) % 100) / 50000;
    const hop = analyzeWindow(noise, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1);
    expect(toneFromHop(hop, 1e-4, 1e-3).tone).toBe(false);
  });

  it("accepts a strong ultrasonic mark", () => {
    const mark = synthesizeFsk([1], ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1);
    const hop = analyzeWindow(mark.subarray(0, 2048), ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1);
    const reading = toneFromHop(hop, 1e-8, 1e-5);
    expect(reading.tone).toBe(true);
    expect(reading.decision).toBe(1);
  });

  it("learns noise then flushes only after a tone burst goes quiet", () => {
    const collector = new BurstCollector();
    const noise = new Float32Array(2048);
    const mark = synthesizeFsk([1], ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1);
    const toneHop = analyzeWindow(mark.subarray(0, 2048), ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1);
    const quietHop = analyzeWindow(noise, ULTRASONIC_FREQ_0, ULTRASONIC_FREQ_1);

    for (let i = 0; i < 20; i += 1) {
      expect(collector.push(quietHop).event).toBe("quiet");
    }
    expect(collector.hops).toHaveLength(0);

    expect(collector.push(toneHop).event).toBe("collecting");
    expect(collector.hops).toHaveLength(1);

    let flushed = false;
    for (let i = 0; i < 30; i += 1) {
      if (collector.push(quietHop).event === "flush") {
        flushed = true;
        break;
      }
    }
    expect(flushed).toBe(true);
    expect(collector.takeBurst()).toHaveLength(1);
  });
});
