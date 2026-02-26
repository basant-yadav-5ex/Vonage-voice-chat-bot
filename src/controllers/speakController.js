import { callState, shouldConsiderCallActive, resetInactivityTimer } from "../state/callState.js";
import { generateJwt } from "../config/vonage.js";
import { fetchWithRetry } from "../utils/retry.js";
import { continueListeningNCCO } from "../ncco/ncco.js";

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

  const lower = text.toLowerCase();
  return sorryPhrases.some(p => lower.includes(p));
}

export async function speak(req, res, io) {
  const { text } = req.body;
  console.log(':::::::::::::::::::::::::::::/api/speak:::::::::::::::::::::::::::text==============>', text);

  if (!shouldConsiderCallActive()) {
    return res.status(400).json({ error: "No active call" });
  }

  const isSorry = isSorryMessage(text);
  resetInactivityTimer();

  callState.isSpeaking = true;

  if (callState.speakingTimeout) clearTimeout(callState.speakingTimeout);
  callState.speakingTimeout = setTimeout(() => {
    callState.isSpeaking = false;
  }, text.length * 80 + 2000);

  try {
    const jwt = generateJwt();

    const talkUrl = `https://api.nexmo.com/v1/calls/${callState.activeCallUuid}/talk`;

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
      ...continueListeningNCCO(process.env.BASE_URL)
    ];

    const transferResp = await fetchWithRetry(
      `https://api.nexmo.com/v1/calls/${callState.activeCallUuid}`,
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

    if (err.message.includes("404") || err.message.includes("not found")) {
      callState.activeCallUuid = null;
      callState.isCallActive = false;
    }

    return res.status(500).json({ error: err.message });
  }
}