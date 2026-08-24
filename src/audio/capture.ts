export async function attachPcmTap(
  context: AudioContext,
  source: AudioNode,
  onChunk: (samples: Float32Array) => void,
): Promise<() => void> {
  try {
    await context.audioWorklet.addModule("/fsk-worklet.js");
    const node = new AudioWorkletNode(context, "fsk-capture");
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(context.destination);
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      onChunk(event.data);
    };
    return () => {
      node.port.onmessage = null;
      source.disconnect(node);
      node.disconnect();
      mute.disconnect();
    };
  } catch {
    const processor = context.createScriptProcessor(512, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    processor.onaudioprocess = (event) => {
      onChunk(event.inputBuffer.getChannelData(0).slice());
    };
    return () => {
      processor.onaudioprocess = null;
      source.disconnect(processor);
      processor.disconnect();
      mute.disconnect();
    };
  }
}
