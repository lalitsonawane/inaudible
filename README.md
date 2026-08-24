# Inaudible

Proof of concept for **inaudible data transmission** on web and mobile browsers using only standard audio APIs.

| Role | API | Frequencies |
| --- | --- | --- |
| Sender | `OscillatorNode` Frequency Shift Keying | **18.5 kHz = 0**, **19.5 kHz = 1** |
| Receiver | Microphone stream + `AnalyserNode` FFT | Peak bins around those two carriers |

```bash
npm install
npm test
npm run dev
```

Microphone access needs HTTPS or localhost.
