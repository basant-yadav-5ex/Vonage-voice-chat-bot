import { startCall, endCall } from "./controllers/callController.js";
import { handleAnswer, handleEvent } from "./controllers/webhookController.js";
import { handleAsr } from "./controllers/asrController.js";
import { speak } from "./controllers/speakController.js";
import { callState, shouldConsiderCallActive } from "./state/callState.js";

export default function registerRoutes(app, io) {
    app.post("/api/call/start", (req, res) =>
        startCall(req, res, io)
    );

    app.get("/api/config", (req, res) => {
        res.json({
            customerNumber: process.env.CUSTOMER_NUMBER || "",
            botNumber: process.env.BOT_NUMBER || ""
        });
    });

    app.post("/api/call/end", (req, res) =>
        endCall(req, res, io)
    );

    app.post("/api/speak", (req, res) =>
        speak(req, res, io)
    );

    app.get("/webhooks/answer", handleAnswer);

    app.post("/webhooks/event", (req, res) =>
        handleEvent(req, res, io)
    );

    app.post("/webhooks/asr", (req, res) =>
        handleAsr(req, res, io)
    );

    app.get("/api/health", (req, res) => {
        res.json({
            activeCallUuid: callState.activeCallUuid,
            isCallActive: callState.isCallActive,
            shouldConsiderActive: shouldConsiderCallActive(),
            isSpeaking: callState.isSpeaking,
            hasPendingAudio: !!callState.pendingAudio,
            hasPendingText: !!callState.pendingText,
            pendingTextContent: callState.pendingText?.text || null,
            pendingAudioComplete: callState.pendingAudio?.isComplete || false,
            pendingTextComplete: callState.pendingText?.isComplete || false,
            uptime: process.uptime()
        });
    });
}
