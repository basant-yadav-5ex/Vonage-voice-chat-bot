import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { Vonage } from "@vonage/server-sdk";
import { readFileSync } from "fs";
import { tokenGenerate } from "@vonage/jwt";
import { WebSocketServer } from "ws";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

/* ---------------- CALL STATE ---------------- */

let activeCallUuid = null;
let isCallActive = false;
let callStartTime = null;
let isSpeaking = false;
let speakingTimeout = null;
let inactivityTimer = null;

/* ---------------- VONAGE ---------------- */

const privateKey = readFileSync(
  process.env.VONAGE_PRIVATE_KEY_PATH,
  "utf8"
);

const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
  applicationId: process.env.VONAGE_APPLICATION_ID,
  privateKey
});

/* ---------------- MESSAGE SYNCHRONIZATION ---------------- */
// Simple queue for pending messages
let pendingAudio = null;
let pendingText = null;
let messageCounter = 0;

/* ---------------- HELPERS ---------------- */

function shouldConsiderCallActive() {
  return isCallActive && activeCallUuid !== null;
}

function generateJwt() {
  return tokenGenerate(process.env.VONAGE_APPLICATION_ID, privateKey);
}

function resetInactivityTimer() {
  // Clear existing timer
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }

  // Set new timer for 20 seconds
  if (isCallActive) {
    inactivityTimer = setTimeout(async () => {
      console.log(">> 20 seconds inactivity - ending call automatically");

      if (activeCallUuid && isCallActive) {
        try {
          await vonage.voice.hangupCall(activeCallUuid);

          activeCallUuid = null;
          isCallActive = false;
          callStartTime = null;
          isSpeaking = false;
          pendingAudio = null;
          pendingText = null;
          messageCounter = 0;

          io.emit("status", "📴 Call ended (inactivity)");
          console.log(">> Call ended due to inactivity");
        } catch (err) {
          console.error("Failed to end call automatically:", err);
        }
      }

      inactivityTimer = null;
    }, 20000); // 20 seconds
  }
}

/* ---------------- SPECIAL MESSAGE HANDLING ---------------- */

function isSorryMessage(text) {
  const sorryPhrases = [
    "i'm sorry i didn't catch that",
    "I'm sorry I didn't catch that could you please repeat what you said",
    "i'm sorry, i didn't catch that",
    "sorry i didn't catch that",
    "sorry, i didn't catch that",
    "i didn't catch that",
    "could you please repeat",
    "please repeat what you said",
    "repeat that"
  ];

  const lowerText = text.toLowerCase();
  return sorryPhrases.some(phrase => lowerText.includes(phrase));
}

/* ---------------- NCCO GENERATION ---------------- */

// function listenNCCOCombined() {
//   const wsUrl = process.env.BASE_URL
//     .replace("https://", "wss://")
//     .replace("http://", "ws://");

//   return [
//     {
//       action: "connect",
//       endpoint: [
//         {
//           type: "websocket",
//           uri: `${wsUrl}/ws/vonage`,
//           "content-type": "audio/l16;rate=16000",
//           headers: {}
//         }
//       ]
//     },
//     {
//       action: "input",
//       type: ["speech"],
//       speech: {
//         language: "en-US",
//         startTimeout: 15,
//         endOnSilence: 2.5, // Increased to capture complete sentences
//         maxDuration: 60
//       },
//       eventUrl: [`${process.env.BASE_URL}/webhooks/asr`],
//       eventMethod: "POST"
//     }
//   ];
// }

function initialNCCO() {
  const wsUrl = process.env.BASE_URL
    .replace("https://", "wss://")
    .replace("http://", "ws://");

  return [
    {
      action: "connect",
      endpoint: [
        {
          type: "websocket",
          uri: `${wsUrl}/ws/vonage`,
          "content-type": "audio/l16;rate=16000"
        }
      ]
    },
    {
      action: "input",
      type: ["speech"],
      speech: {
        language: "en-US",
        endOnSilence: 2.5,
        maxDuration: 60,
        startTimeout: 15,
        sensitivity: 75,
        saveAudio: false
      },
      eventUrl: [`${process.env.BASE_URL}/webhooks/asr`],
      eventMethod: "POST"
    }
  ];
}

function continueListeningNCCO() {
  return [
    {
      action: "input",
      type: ["speech"],
      speech: {
        language: "en-US",
        endOnSilence: 2.5,
        maxDuration: 60,
        startTimeout: 15,
        sensitivity: 75,
        saveAudio: false
      },
      eventUrl: [`${process.env.BASE_URL}/webhooks/asr`],
      eventMethod: "POST"
    }
  ];
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

/* ---------------- VONAGE WEBSOCKET AUDIO STREAM ---------------- */

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

  // Reset inactivity timer when connection is established
  resetInactivityTimer();

  let audioChunks = [];
  let silenceFrames = 0;
  let hasSpoken = false;
  let currentUtteranceId = null;
  let utteranceStartTime = null;

  const SILENCE_THRESHOLD = 150;
  const SILENCE_REQUIRED = 120; // Increased to ensure complete sentences
  const MIN_AUDIO_BYTES = 3200;

  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      console.log(">> WS metadata:", data.toString());
      return;
    }

    // Don't record while the bot is speaking
    if (isSpeaking) {
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
      // Speech detected - reset inactivity timer
      resetInactivityTimer();

      if (!hasSpoken) {
        // Start of a new utterance
        hasSpoken = true;
        audioChunks = [];
        silenceFrames = 0;
        utteranceStartTime = Date.now();
        currentUtteranceId = `utt_${utteranceStartTime}_${++messageCounter}`;
        console.log(`>> Started recording: ${currentUtteranceId}`);
      }
      silenceFrames = 0;
      audioChunks.push(buffer);
    } else {
      // Silence detected
      if (hasSpoken) {
        audioChunks.push(buffer);
        silenceFrames++;

        // Check if we've had enough silence to end the utterance
        if (silenceFrames >= SILENCE_REQUIRED) {
          // End of utterance - process the complete audio
          if (audioChunks.length > 0) {
            const pcmData = Buffer.concat(audioChunks);

            if (pcmData.length > MIN_AUDIO_BYTES) {
              const wavBuffer = pcmToWav(pcmData, 16000, 16, 1);
              const audioBase64 = wavBuffer.toString("base64");

              console.log(`>> Audio captured: ${currentUtteranceId}, size: ${pcmData.length} bytes`);

              // Store the audio
              pendingAudio = {
                id: currentUtteranceId,
                audio: audioBase64,
                timestamp: utteranceStartTime,
                isComplete: true // Mark as complete
              };

              // Check if we have pending text to match
              if (pendingText && pendingText.isComplete) {
                console.log(`>> Matching audio ${currentUtteranceId} with pending text: "${pendingText.text}"`);
                io.emit("voice-message", {
                  id: currentUtteranceId,
                  text: pendingText.text,
                  audio: audioBase64,
                  timestamp: Date.now(),
                  isComplete: true
                });
                pendingText = null;
                pendingAudio = null;
              } else if (pendingText && !pendingText.isComplete) {
                console.log(`>> Waiting for complete text for ${currentUtteranceId}`);
              }
            }
          }

          // Reset for next utterance
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
    // Process any remaining audio
    if (hasSpoken && audioChunks.length > 0 && currentUtteranceId) {
      const pcmData = Buffer.concat(audioChunks);
      if (pcmData.length > MIN_AUDIO_BYTES) {
        const wavBuffer = pcmToWav(pcmData, 16000, 16, 1);
        const audioBase64 = wavBuffer.toString("base64");

        pendingAudio = {
          id: currentUtteranceId,
          audio: audioBase64,
          timestamp: utteranceStartTime,
          isComplete: true
        };

        if (pendingText && pendingText.isComplete) {
          io.emit("voice-message", {
            id: currentUtteranceId,
            text: pendingText.text,
            audio: audioBase64,
            timestamp: Date.now(),
            isComplete: true
          });
          pendingText = null;
          pendingAudio = null;
        }
      }
    }
  });
});

/* ---------------- START CALL ---------------- */

app.post("/api/call/start", async (req, res) => {
  try {
    const call = await makeCallWithRetry(3);

    activeCallUuid = call.uuid;
    isCallActive = true;
    callStartTime = Date.now();

    resetInactivityTimer();

    io.emit("status", "📞 Call connected");

    res.json({ success: true, uuid: call.uuid });

  } catch (err) {
    console.error("Call start failed:", err.message);
    res.status(500).json({ error: "Call failed after retries" });
  }
});

async function makeCallWithRetry(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const call = await vonage.voice.createOutboundCall({
        to: [{ type: "phone", number: "+17813044745" }],
        from: { type: "phone", number: process.env.VONAGE_VIRTUAL_NUMBER },
        answer_url: [`${process.env.BASE_URL}/webhooks/answer`],
        event_url: [`${process.env.BASE_URL}/webhooks/event`]
      });

      return call; // success
    } catch (err) {
      console.log(`Attempt ${i + 1} failed:`, err.message);

      if (i === retries - 1) throw err;

      // wait 2 seconds before retry
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}



/* ---------------- END CALL ---------------- */

app.post("/api/call/end", async (req, res) => {
  try {
    if (!activeCallUuid || !isCallActive) {
      return res.json({ success: false, message: "No active call" });
    }

    // Try to hangup with retry
    await hangupWithRetry(activeCallUuid, 3);

    // Force cleanup (even if API slow)
    activeCallUuid = null;
    isCallActive = false;
    callStartTime = null;
    isSpeaking = false;
    pendingAudio = null;
    pendingText = null;
    messageCounter = 0;

    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }

    io.emit("status", "📴 Call ended");

    res.json({ success: true });

  } catch (err) {
    console.error("Call end error:", err.message);

    // IMPORTANT: Even if Vonage fails, clear local state
    activeCallUuid = null;
    isCallActive = false;

    res.status(500).json({
      success: false,
      error: "Call termination failed after retries"
    });
  }
});


async function hangupWithRetry(uuid, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await vonage.voice.hangupCall(uuid);
      return true; // success
    } catch (err) {
      console.log(`Hangup attempt ${i + 1} failed:`, err.message);

      if (i === retries - 1) throw err;

      // wait 2 sec before retry
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}


/* ---------------- SPEAK (TTS via Talk API) ---------------- */

app.post("/api/speak", async (req, res) => {
  const { text } = req.body;
  console.log(':::::::::::::::::::::::::::::/api/speak:::::::::::::::::::::::::::text==============>', text);

  if (!shouldConsiderCallActive()) {
    return res.status(400).json({ error: "No active call" });
  }

  const isSorry = isSorryMessage(text);
  resetInactivityTimer();

  isSpeaking = true;

  if (speakingTimeout) clearTimeout(speakingTimeout);
  speakingTimeout = setTimeout(() => {
    isSpeaking = false;
  }, text.length * 80 + 2000);

  try {
    const jwt = generateJwt();

    const talkUrl = `https://api.nexmo.com/v1/calls/${activeCallUuid}/talk`;

    const talkResp = await fetchWithRetry(
      talkUrl,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text,
          language: "en-US",
          style: 0,
          level: 0.4
        })
      },
      3
    );

    const talkBody = await talkResp.text();

    if (talkResp.ok) {
      if (!isSorry) io.emit("status", "typing");
      return res.json({ success: true, via: "talk-api", isSorry });
    }

    // 🔁 Fallback to Transfer (with retry)

    const ncco = [
      {
        action: "talk",
        text,
        language: "en-US",
        style: 0
      },

      // ...listenNCCOCombined()
      ...continueListeningNCCO()
    ];

    const transferResp = await fetchWithRetry(
      `https://api.nexmo.com/v1/calls/${activeCallUuid}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "transfer",
          destination: { type: "ncco", ncco }
        })
      },
      3
    );

    if (!transferResp.ok) {
      return res.status(500).json({
        error: "Talk + Transfer both failed"
      });
    }

    if (!isSorry) io.emit("status", "typing");

    return res.json({ success: true, via: "transfer", isSorry });

  } catch (err) {
    console.error("Speak error:", err.message);

    // If call died during speech
    if (err.message.includes("404") || err.message.includes("not found")) {
      activeCallUuid = null;
      isCallActive = false;
    }

    return res.status(500).json({ error: err.message });
  }
});

/* ---------------- ANSWER ---------------- */

app.get("/webhooks/answer", (req, res) => {
  activeCallUuid = req.query.uuid;
  isCallActive = true;
  callStartTime = Date.now();
  console.log(">> Answer webhook — uuid:", activeCallUuid);

  // Start inactivity timer when call connects
  resetInactivityTimer();

  // res.json(listenNCCOCombined());
  res.json(initialNCCO());
});

/* ---------------- EVENTS ---------------- */

app.post("/webhooks/event", (req, res) => {
  const { status, uuid, type } = req.body;
  console.log(">> Event:", JSON.stringify({ status, uuid, type }));

  // Only track UUID if call becomes active
  if (status === "answered" && uuid) {
    activeCallUuid = uuid;
    isCallActive = true;
    callStartTime = Date.now();
    resetInactivityTimer();
    console.log(">> Call answered:", uuid);
  }

  // Transfer event (do NOT return early)
  if (type === "transfer") {
    console.log(">> Call transferred");
    isCallActive = true;
  }

  // End states (only for active call UUID)
  const endStates = ["completed", "failed", "rejected", "busy", "cancelled"];

  if (
    endStates.includes(status) &&
    isCallActive === true &&
    uuid === activeCallUuid
  ) {
    console.log(">> Cleaning up call:", uuid);

    activeCallUuid = null;
    isCallActive = false;
    callStartTime = null;
    isSpeaking = false;
    pendingAudio = null;
    pendingText = null;
    messageCounter = 0;

    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }

    io.emit("status", "📴 Call ended");
    console.log(">> Call ended event emitted");
  }

  res.sendStatus(200);
});

/* ---------------- ASR (STT) ---------------- */

app.post("/webhooks/asr", (req, res) => {
  console.log(">> ASR webhook received");

  if (!isCallActive) {
    return res.sendStatus(200);
  }

  const results = req.body?.speech?.results;
  console.log(":::::::::::::::::::::::::::::::::webhooks/asr::::::::::::::::::::::::::::::results===========>", results);

   if (!results.length) {
    return res.json(continueListeningNCCO());
  }

  // pick highest confidence
  const best = results.reduce((prev, current) =>
    parseFloat(current.confidence) > parseFloat(prev.confidence)
      ? current
      : prev
  );

  let cleanMessage = best.text
    .replace(/Ava from/gi, "AIVA")
    .replace(/able from/gi, "AIVA")
    .replace(/\b1\b/g, "one")
    .replace(/\s+/g, " ")
    .trim();

  console.log(">> FINAL TEXT:", cleanMessage);

  resetInactivityTimer();

  pendingText = {
    text: cleanMessage,
    timestamp: Date.now(),
    isComplete: true
  };

  if (pendingAudio?.isComplete) {
    io.emit("voice-message", {
      id: pendingAudio.id,
      text: pendingText.text,
      audio: pendingAudio.audio,
      timestamp: Date.now(),
      isComplete: true
    });

    pendingAudio = null;
    pendingText = null;
  }

  // res.json(listenNCCOCombined());
  res.json(continueListeningNCCO());
});

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) return response;

      console.log(`Attempt ${i + 1} failed with status ${response.status}`);

      if (i === retries - 1) return response;

    } catch (err) {
      console.log(`Attempt ${i + 1} error:`, err.message);
      if (i === retries - 1) throw err;
    }

    await new Promise(r => setTimeout(r, 2000)); // 2 sec wait
  }
}


/* ---------------- HEALTH ---------------- */
/* --The /api/health endpoint is a monitoring and debugging endpoint that provides real-time information -- */

app.get("/api/health", (req, res) => {
  res.json({
    activeCallUuid,
    isCallActive,
    shouldConsiderActive: shouldConsiderCallActive(),
    isSpeaking,
    hasPendingAudio: !!pendingAudio,
    hasPendingText: !!pendingText,
    pendingTextContent: pendingText?.text || null,
    pendingAudioComplete: pendingAudio?.isComplete || false,
    pendingTextComplete: pendingText?.isComplete || false,
    uptime: process.uptime()
  });
});

/* ---------------- SERVER ---------------- */

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
