import { callState, resetInactivityTimer } from "../state/callState.js";
import { continueListeningNCCO } from "../ncco/ncco.js";

export function handleAsr(req, res, io) {
    console.log(">> ASR webhook received");

    if (!callState.isCallActive) {
        return res.sendStatus(200);
    }

    const results = req.body?.speech?.results;
    const recordingUrl = req.body?.speech?.recording_url;
    
    console.log(">> ASR results:", results);
    console.log(">> Recording URL:", recordingUrl);

    if (!Array.isArray(results) || results.length === 0) {
        console.log(">> No speech detected, continuing to listen");
        return res.json(continueListeningNCCO(process.env.BASE_URL));
    }

    // Pick highest confidence
    const best = results.reduce((prev, current) =>
        parseFloat(current.confidence) > parseFloat(prev.confidence)
            ? current
            : prev
    );

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
    console.log(">> Text confidence:", best.confidence);

    resetInactivityTimer();

    // ✅ SOLUTION: Store text and wait for audio with timeout
    callState.pendingText = {
        text: cleanMessage,
        timestamp: Date.now(),
        recordingUrl: recordingUrl,
        isComplete: true
    };

    console.log(">> pendingAudio exists?", !!callState.pendingAudio);
    console.log(">> pendingAudio.isComplete?", callState.pendingAudio?.isComplete);

    // If audio already captured, emit immediately
    if (callState.pendingAudio?.isComplete) {
        console.log(">> Audio already ready, emitting voice-message immediately");
        emitVoiceMessage(io);
        return res.json(continueListeningNCCO(process.env.BASE_URL));
    }

    // Audio not ready yet - wait for it (max 3 seconds)
    console.log(">> Waiting for audio to arrive from WebSocket (max 3 seconds)");
    
    if (callState.asrTimeoutId) {
        clearTimeout(callState.asrTimeoutId);
    }

    callState.asrTimeoutId = setTimeout(() => {
        console.log(">> ASR timeout: audio didn't arrive in time, using recording URL instead");
        
        if (callState.pendingText?.isComplete) {
            // Use recording URL from Vonage if available, or emit with null audio
            io.emit("voice-message", {
                id: `asr_${Date.now()}`,
                text: callState.pendingText.text,
                audio: null,
                recordingUrl: callState.pendingText.recordingUrl,
                timestamp: Date.now(),
                isComplete: true,
                source: "asr"
            });

            callState.pendingAudio = null;
            callState.pendingText = null;
        }

        callState.asrTimeoutId = null;
    }, 3000);

    res.json(continueListeningNCCO(process.env.BASE_URL));
}

function emitVoiceMessage(io) {
    if (callState.pendingText && callState.pendingAudio) {
        io.emit("voice-message", {
            id: callState.pendingAudio.id,
            text: callState.pendingText.text,
            audio: callState.pendingAudio.audio,
            recordingUrl: callState.pendingText.recordingUrl,
            timestamp: Date.now(),
            isComplete: true,
            source: "websocket"
        });

        if (callState.asrTimeoutId) {
            clearTimeout(callState.asrTimeoutId);
            callState.asrTimeoutId = null;
        }

        callState.pendingAudio = null;
        callState.pendingText = null;
    }
}
