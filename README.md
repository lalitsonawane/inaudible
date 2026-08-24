# Inaudible

Proof of concept for **inaudible data transmission** on web and mobile browsers using only standard audio APIs.

| Role | API | Frequencies |
| --- | --- | --- |
| Sender | `OscillatorNode` Frequency Shift Keying | **17.5 kHz = 0**, **18.5 kHz = 1** |
| Receiver | Microphone stream + `AnalyserNode` FFT | Mid-symbol samples after 0/1 clock lock |

```bash
npm install
npm test
npm run dev
```

Microphone access needs HTTPS or localhost.
