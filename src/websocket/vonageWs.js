// import { WebSocketServer } from "ws";
// import { callState, resetInactivityTimer } from "../state/callState.js";
// import { transcribeAudio } from "../services/speechToText.js";
// import { exec } from "child_process";
// import fs from "fs";
// import path from "path";

// export default function setupVonageWs(server, io) {
//   const wss = new WebSocketServer({ noServer: true });

//   server.on("upgrade", (req, socket, head) => {
//     const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
//     if (pathname === "/ws/vonage") {
//       wss.handleUpgrade(req, socket, head, (ws) => {
//         wss.emit("connection", ws, req);
//       });
//     }
//   });

//   wss.on("connection", (ws) => {
//     console.log(">> Vonage WebSocket connected");

//     resetInactivityTimer();

//     let audioChunks = [];
//     let silenceFrames = 0;
//     let hasSpoken = false;
//     let currentUtteranceId = null;
//     let utteranceStartTime = null;

//     const SILENCE_THRESHOLD = 150;
//     const SILENCE_REQUIRED = 120;
//     const MIN_AUDIO_BYTES = 3200;

//     ws.on("message", (data, isBinary) => {
//       if (!isBinary) {
//         console.log(">> WS metadata:", data.toString());
//         return;
//       }

//       // Don't record while the bot is speaking
//       if (callState.isSpeaking) {
//         return;
//       }

//       const buffer = Buffer.from(data);
//       const samples = new Int16Array(
//         buffer.buffer, buffer.byteOffset, buffer.byteLength / 2
//       );

//       let sum = 0;
//       for (let i = 0; i < samples.length; i++) {
//         sum += samples[i] * samples[i];
//       }
//       const rms = Math.sqrt(sum / samples.length);

//       if (rms > SILENCE_THRESHOLD) {
//         resetInactivityTimer();

//         if (!hasSpoken) {
//           hasSpoken = true;
//           audioChunks = [];
//           silenceFrames = 0;
//           utteranceStartTime = Date.now();
//           currentUtteranceId = `utt_${utteranceStartTime}_${++callState.messageCounter}`;
//           console.log(`>> Started recording: ${currentUtteranceId}`);
//         }
//         silenceFrames = 0;
//         audioChunks.push(buffer);
//       } else {
//         if (hasSpoken) {
//           audioChunks.push(buffer);
//           silenceFrames++;

//           if (silenceFrames >= SILENCE_REQUIRED) {
//             if (audioChunks.length > 0) {
//               const pcmData = Buffer.concat(audioChunks);

//               if (pcmData.length > MIN_AUDIO_BYTES) {
//                 const wavBuffer = pcmToWav(pcmData, 16000, 16, 1);
//                 const audioBase64 = wavBuffer.toString("base64");

//                 console.log(`>> 🎤 Complete audio: ${currentUtteranceId}, ${pcmData.length} bytes`);
//                 console.log(`>> 🔄 Converting to text with Python Whisper...`);

//                 // Use async transcription
//                 transcribeAudio(audioBase64, currentUtteranceId).then((result) => {
//                   console.log(`>> ✅ Whisper text: "${result.text}"`);

//                   // Emit ONLY Python Whisper text (ignore Vonage ASR)
//                   io.emit("voice-message", {
//                     id: currentUtteranceId,
//                     text: result.text,
//                     audio: audioBase64,
//                     timestamp: Date.now(),
//                     isComplete: true,
//                     source: "whisper"
//                   });

//                   // Clear any pending text from Vonage ASR
//                   callState.pendingText = null;
//                   callState.pendingAudio = null;
//                   if (callState.asrTimeoutId) {
//                     clearTimeout(callState.asrTimeoutId);
//                     callState.asrTimeoutId = null;
//                   }
//                 }).catch((error) => {
//                   console.error(`>> ❌ Whisper failed: ${error.message}`);
//                   // Emit audio only (empty text)
//                   io.emit("voice-message", {
//                     id: currentUtteranceId,
//                     text: "",
//                     audio: audioBase64,
//                     timestamp: Date.now(),
//                     isComplete: true,
//                     source: "audio-only"
//                   });
//                 });
//               }
//             }

//             audioChunks = [];
//             silenceFrames = 0;
//             hasSpoken = false;
//             currentUtteranceId = null;
//             utteranceStartTime = null;
//           }
//         }
//       }
//     });

//     ws.on("close", () => {

//       console.log(">> Vonage WebSocket closed");

//       const recordingsDir = path.join(process.cwd(), "recordings");

//       if (hasSpoken && audioChunks.length > 0 && currentUtteranceId) {

//         const pcmData = Buffer.concat(audioChunks);

//         if (pcmData.length > MIN_AUDIO_BYTES) {

//           const wavBuffer = pcmToWav(pcmData, 16000, 16, 1);

//           try {

//             if (!fs.existsSync(recordingsDir)) {
//               fs.mkdirSync(recordingsDir, { recursive: true });
//             }

//             // Clean folder
//             const files = fs.readdirSync(recordingsDir);

//             for (const file of files) {
//               fs.unlinkSync(path.join(recordingsDir, file));
//             }

//             console.log("🧹 Recordings folder cleaned");

//           } catch (err) {
//             console.log("⚠️ Cleanup skipped:", err.message);
//           }

//           const filePath = path.join(recordingsDir, `${currentUtteranceId}.wav`);

//           try {
//             fs.writeFileSync(filePath, wavBuffer);
//           } catch (err) {
//             console.log("⚠️ File write skipped:", err.message);
//             return;
//           }

//         }
//       }
//     });
//   });
// }

// function pcmToWav(pcmData, sampleRate, bitsPerSample, channels) {
//   const byteRate = sampleRate * channels * (bitsPerSample / 8);
//   const blockAlign = channels * (bitsPerSample / 8);
//   const header = Buffer.alloc(44);

//   header.write("RIFF", 0);
//   header.writeUInt32LE(36 + pcmData.length, 4);
//   header.write("WAVE", 8);
//   header.write("fmt ", 12);
//   header.writeUInt32LE(16, 16);
//   header.writeUInt16LE(1, 20);
//   header.writeUInt16LE(channels, 22);
//   header.writeUInt32LE(sampleRate, 24);
//   header.writeUInt32LE(byteRate, 28);
//   header.writeUInt16LE(blockAlign, 32);
//   header.writeUInt16LE(bitsPerSample, 34);
//   header.write("data", 36);
//   header.writeUInt32LE(pcmData.length, 40);

//   return Buffer.concat([header, pcmData]);
// }

import { WebSocketServer } from "ws";
import { callState, resetInactivityTimer } from "../state/callState.js";
import { transcribeAudio } from "../services/speechToText.js";

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
    let currentUtteranceToken = null;

    const SILENCE_THRESHOLD = 150;
    const SILENCE_REQUIRED = 120;
    const MIN_AUDIO_BYTES = 3200;

    ws.on("message", (data, isBinary) => {

      if (!isBinary) {
        console.log(">> WS metadata:", data.toString());
        return;
      }

      if (callState.isSpeaking) return;

      const buffer = Buffer.from(data);

      const samples = new Int16Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength / 2
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
          currentUtteranceId =
            `utt_${utteranceStartTime}_${++callState.messageCounter}`;
          currentUtteranceToken = callState.sessionToken;

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

                const utteranceId = currentUtteranceId;
                const utteranceToken = currentUtteranceToken;

                console.log(`>> 🎤 Complete audio: ${utteranceId}`);

                transcribeAudio(audioBase64, utteranceId)
                  .then((result) => {

                    if (!utteranceId) return;
                    if (utteranceToken !== callState.sessionToken) {
                      console.log(`>> Skipping stale utterance: ${utteranceId}`);
                      return;
                    }

                    console.log(`>> ✅ Whisper text: "${result.text}"`);

                    io.emit("voice-message", {
                      id: utteranceId,
                      text: result.text,
                      audio: audioBase64,
                      callId: callState.sessionId,
                      timestamp: Date.now(),
                      isComplete: true,
                      source: "whisper"
                    });

                    callState.pendingText = null;
                    callState.pendingAudio = null;

                    if (callState.asrTimeoutId) {
                      clearTimeout(callState.asrTimeoutId);
                      callState.asrTimeoutId = null;
                    }

                  })
                  .catch((error) => {

                    console.error(`>> ❌ Whisper failed: ${error.message}`);

                    if (utteranceToken !== callState.sessionToken) {
                      console.log(`>> Skipping stale utterance (error): ${utteranceId}`);
                      return;
                    }

                    io.emit("voice-message", {
                      id: utteranceId,
                      text: "",
                      audio: audioBase64,
                      callId: callState.sessionId,
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
            currentUtteranceToken = null;
          }
        }
      }
    });

    ws.on("close", () => {

      console.log(">> Vonage WebSocket closed");

      callState.isSpeaking = false;
      callState.pendingText = null;
      callState.pendingAudio = null;
      callState.sessionId = null;

      if (callState.asrTimeoutId) {
        clearTimeout(callState.asrTimeoutId);
        callState.asrTimeoutId = null;
      }

      audioChunks = [];
      silenceFrames = 0;
      hasSpoken = false;
      currentUtteranceId = null;
      utteranceStartTime = null;
      currentUtteranceToken = null;

      io.emit("status", "Call ended");
      io.emit("call-session", { callId: null, isActive: false });

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
