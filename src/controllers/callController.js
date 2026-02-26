import { vonage } from "../config/vonage.js";
import { callState, resetInactivityTimer } from "../state/callState.js";

export async function startCall(req, res, io) {
    console.log('Start call ::::::::::::::::::>>>>>>>>>')
  try {
    const call = await makeCallWithRetry(3);

    callState.activeCallUuid = call.uuid;
    callState.isCallActive = true;
    callState.callStartTime = Date.now();

    resetInactivityTimer();

    io.emit("status", "📞 Call connected");

    res.json({ success: true, uuid: call.uuid });
  } catch (err) {
    console.error("Call start failed:", err.message);
    res.status(500).json({ error: "Call failed after retries" });
  }
}

export async function endCall(req, res, io) {
  try {
    if (!callState.activeCallUuid || !callState.isCallActive) {
      return res.json({ success: false, message: "No active call" });
    }

    await hangupWithRetry(callState.activeCallUuid, 3);

    // Force cleanup
    callState.activeCallUuid = null;
    callState.isCallActive = false;
    callState.callStartTime = null;
    callState.isSpeaking = false;
    callState.pendingAudio = null;
    callState.pendingText = null;
    callState.messageCounter = 0;

    if (callState.inactivityTimer) {
      clearTimeout(callState.inactivityTimer);
      callState.inactivityTimer = null;
    }

    io.emit("status", "📴 Call ended");

    res.json({ success: true });
  } catch (err) {
    console.error("Call end error:", err.message);

    callState.activeCallUuid = null;
    callState.isCallActive = false;

    res.status(500).json({
      success: false,
      error: "Call termination failed after retries"
    });
  }
}

async function makeCallWithRetry(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const call = await vonage.voice.createOutboundCall({
        to: [{ type: "phone", number: "+17813044745" }],
        from: { type: "phone", number: process.env.VONAGE_VIRTUAL_NUMBER },
        answer_url: [`${process.env.BASE_URL}/webhooks/answer`],
        event_url: [`${process.env.BASE_URL}/webhooks/event`]
      });

      return call;
    } catch (err) {
      console.log(`Attempt ${i + 1} failed:`, err.message);

      if (i === retries - 1) throw err;

      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

async function hangupWithRetry(uuid, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await vonage.voice.hangupCall(uuid);
      return true;
    } catch (err) {
      console.log(`Hangup attempt ${i + 1} failed:`, err.message);

      if (i === retries - 1) throw err;

      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}