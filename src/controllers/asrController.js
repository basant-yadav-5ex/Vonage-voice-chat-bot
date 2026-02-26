import { callState, resetInactivityTimer } from "../state/callState.js";
import { continueListeningNCCO } from "../ncco/ncco.js";

export function handleAsr(req, res, io) {
    console.log(">> ASR webhook received");

    if (!callState.isCallActive) {
        return res.sendStatus(200);
    }

    const results = req.body?.speech?.results;

    if (!Array.isArray(results) || results.length === 0) {
        return res.json(continueListeningNCCO(process.env.BASE_URL));
    }

    // pick highest confidence
    const best = results.reduce((prev, current) =>
        parseFloat(current.confidence) > parseFloat(prev.confidence)
            ? current
            : prev
    );

    // 🔥 SAFE TEXT EXTRACTION
    const rawText = best?.text;

    if (!rawText || typeof rawText !== "string") {
        console.log(">> ASR returned empty or null text");
        return res.json(continueListeningNCCO(process.env.BASE_URL));
    }

    let cleanMessage = rawText
        .replace(/Ava from/gi, "AIVA")
        .replace(/able from/gi, "AIVA")
        .replace(/\b1\b/g, "one")
        .replace(/\s+/g, " ")
        .trim();

    console.log(">> FINAL TEXT:", cleanMessage);

    resetInactivityTimer();

    callState.pendingText = {
        text: cleanMessage,
        timestamp: Date.now(),
        isComplete: true
    };

    if (callState.pendingAudio?.isComplete) {
        io.emit("voice-message", {
            id: callState.pendingAudio.id,
            text: callState.pendingText.text,
            audio: callState.pendingAudio.audio,
            timestamp: Date.now(),
            isComplete: true
        });

        callState.pendingAudio = null;
        callState.pendingText = null;
    }

    res.json(continueListeningNCCO(process.env.BASE_URL));
}