import { callState, resetInactivityTimer } from "../state/callState.js";
import { initialNCCO } from "../ncco/ncco.js";

export function handleAnswer(req, res) {
  callState.activeCallUuid = req.query.uuid;
  callState.isCallActive = true;
  callState.callStartTime = Date.now();
  console.log(">> Answer webhook — uuid:", callState.activeCallUuid);

  resetInactivityTimer();

  res.json(initialNCCO(process.env.BASE_URL));
}

export function handleEvent(req, res, io) {
  const { status, uuid, type } = req.body;
  console.log(">> Event:", JSON.stringify({ status, uuid, type }));

  // Only track UUID if call becomes active
  if (status === "answered" && uuid) {
    callState.activeCallUuid = uuid;
    callState.isCallActive = true;
    callState.callStartTime = Date.now();
    resetInactivityTimer();
    console.log(">> Call answered:", uuid);
  }

  // Transfer event
  if (type === "transfer") {
    console.log(">> Call transferred");
    callState.isCallActive = true;
  }

  // End states
  const endStates = ["completed", "failed", "rejected", "busy", "cancelled"];

  if (
    endStates.includes(status) &&
    callState.isCallActive === true &&
    uuid === callState.activeCallUuid
  ) {
    console.log(">> Cleaning up call:", uuid);

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
    console.log(">> Call ended event emitted");
  }

  res.sendStatus(200);
}