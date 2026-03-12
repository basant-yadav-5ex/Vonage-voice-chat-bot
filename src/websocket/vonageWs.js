import { WebSocketServer } from "ws";
import { callState, resetInactivityTimer } from "../state/callState.js";
import { transcribeAudio } from "../services/speechToText.js";
import { exec } from "child_process";
import fs from "fs";
import path from "path";

export default function setupVonageWs(server, io) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    if (pathname === "/ws/vonage") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  wss.on("connection", (ws) => {
    console.log(">> Vonage WebSocket connected");

    resetInactivityTimer();

    let audioChunks = [];
    let silenceFrames = 0;
    let hasSpoken = false;
    let currentUtteranceId = null;
    let utteranceStartTime = null;

    const SILENCE_THRESHOLD = 150;
    const SILENCE_REQUIRED = 120;
    const MIN_AUDIO_BYTES = 3200;

    ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        console.log(">> WS metadata:", data.toString());
        return;
      }

      // Don't record while the bot is speaking
      if (callState.isSpeaking) {
        return;
      }

      const buffer = Buffer.from(data);
      const samples = new Int16Array(
        buffer.buffer, buffer.byteOffset, buffer.byteLength / 2
      );

      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i];
      }
      const rms = Math.sqrt(sum / samples.length);

      if (rms > SILENCE_THRESHOLD) {
        resetInactivityTimer();

        if (!hasSpoken) {
          hasSpoken = true;
          audioChunks = [];
          silenceFrames = 0;
          utteranceStartTime = Date.now();
          currentUtteranceId = `utt_${utteranceStartTime}_${++callState.messageCounter}`;
          console.log(`>> Started recording: ${currentUtteranceId}`);
        }
        silenceFrames = 0;
        audioChunks.push(buffer);
      } else {
        if (hasSpoken) {
          audioChunks.push(buffer);
          silenceFrames++;

          if (silenceFrames >= SILENCE_REQUIRED) {
            if (audioChunks.length > 0) {
              const pcmData = Buffer.concat(audioChunks);

              if (pcmData.length > MIN_AUDIO_BYTES) {
                const wavBuffer = pcmToWav(pcmData, 16000, 16, 1);
                const audioBase64 = wavBuffer.toString("base64");

                console.log(`>> 🎤 Complete audio: ${currentUtteranceId}, ${pcmData.length} bytes`);
                console.log(`>> 🔄 Converting to text with Python Whisper...`);

                // Use async transcription
                transcribeAudio(audioBase64, currentUtteranceId).then((result) => {
                  console.log(`>> ✅ Whisper text: "${result.text}"`);

                  // Emit ONLY Python Whisper text (ignore Vonage ASR)
                  io.emit("voice-message", {
                    id: currentUtteranceId,
                    text: result.text,
                    audio: audioBase64,
                    timestamp: Date.now(),
                    isComplete: true,
                    source: "whisper"
                  });

                  // Clear any pending text from Vonage ASR
                  callState.pendingText = null;
                  callState.pendingAudio = null;
                  if (callState.asrTimeoutId) {
                    clearTimeout(callState.asrTimeoutId);
                    callState.asrTimeoutId = null;
                  }
                }).catch((error) => {
                  console.error(`>> ❌ Whisper failed: ${error.message}`);
                  // Emit audio only (empty text)
                  io.emit("voice-message", {
                    id: currentUtteranceId,
                    text: "",
                    audio: audioBase64,
                    timestamp: Date.now(),
                    isComplete: true,
                    source: "audio-only"
                  });
                });
              }
            }

            audioChunks = [];
            silenceFrames = 0;
            hasSpoken = false;
            currentUtteranceId = null;
            utteranceStartTime = null;
          }
        }
      }
    });

    ws.on("close", () => {
      console.log(">> Vonage WebSocket closed");

      if (hasSpoken && audioChunks.length > 0 && currentUtteranceId) {

        const pcmData = Buffer.concat(audioChunks);

        if (pcmData.length > MIN_AUDIO_BYTES) {

          const wavBuffer = pcmToWav(pcmData, 16000, 16, 1);

          const filePath = path.join(process.cwd(), "src", "recordings", `${currentUtteranceId}.wav`);

          fs.writeFileSync(filePath, wavBuffer);

          const audioBase64 = wavBuffer.toString("base64");

          callState.pendingAudio = {
            id: currentUtteranceId,
            audio: audioBase64,
            timestamp: utteranceStartTime,
            isComplete: true
          };

          if (callState.pendingText && callState.pendingText.isComplete) {

            const pythonScript = path.join(process.cwd(), "src", "services", "pythonLibrarySTT.py");

            console.log("Python Script:", pythonScript);
            console.log("Audio File:", filePath);

            exec(`python "${pythonScript}" "${filePath}"`, (err, stdout, stderr) => {

              if (err) {
                console.error("❌ Python STT error:", err);
                return;
              }

              if (stderr) {
                console.error("❌ Python stderr:", stderr);
                return;
              }

              if (!stdout) {
                console.error("❌ No output from Python");
                return;
              }

              let result;

              try {
                result = JSON.parse(stdout);
              } catch (parseError) {
                console.error("❌ JSON parse error:", stdout);
                return;
              }

              const text = result.text || "";

              io.emit("voice-message", {
                id: currentUtteranceId,
                text,
                audio: audioBase64,
                timestamp: Date.now(),
                isComplete: true,
                source: "python-whisper"
              });

            });

            callState.pendingText = null;
            callState.pendingAudio = null;
          }
        }
      }
    });
  });
}

function pcmToWav(pcmData, sampleRate, bitsPerSample, channels) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}