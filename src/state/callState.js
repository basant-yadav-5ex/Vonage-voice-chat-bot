export const callState = {
  activeCallUuid: null,
  isCallActive: false,
  callStartTime: null,
  isSpeaking: false,
  speakingTimeout: null,
  inactivityTimer: null,
  pendingAudio: null,
  pendingText: null,
  messageCounter: 0,
  asrTimeoutId: null, // Track ASR waiting timeout
  retryNumber: 3
};

export function shouldConsiderCallActive() {
  return callState.isCallActive && callState.activeCallUuid !== null;
}

export function resetInactivityTimer() {
  if (callState.inactivityTimer) {
    clearTimeout(callState.inactivityTimer);
    callState.inactivityTimer = null;
  }

  if (callState.isCallActive) {
    callState.inactivityTimer = setTimeout(async () => {
      console.log(">> 20 seconds inactivity - ending call automatically");

      if (callState.activeCallUuid && callState.isCallActive) {
        try {
          const { vonage } = await import("../config/vonage.js");
          await vonage.voice.hangupCall(callState.activeCallUuid);

          callState.activeCallUuid = null;
          callState.isCallActive = false;
          callState.callStartTime = null;
          callState.isSpeaking = false;
          callState.pendingAudio = null;
          callState.pendingText = null;
          callState.messageCounter = 0;

          console.log(">> Call ended due to inactivity");
        } catch (err) {
          console.error("Failed to end call automatically:", err);
        }
      }

      callState.inactivityTimer = null;
    }, 2000000);    // ending call automatically within 20 second
  }
}

export function clearCallState() {
  if (callState.speakingTimeout) {
    clearTimeout(callState.speakingTimeout);
    callState.speakingTimeout = null;
  }

  if (callState.inactivityTimer) {
    clearTimeout(callState.inactivityTimer);
    callState.inactivityTimer = null;
  }

  callState.activeCallUuid = null;
  callState.isCallActive = false;
  callState.callStartTime = null;
  callState.isSpeaking = false;
  callState.pendingAudio = null;
  callState.pendingText = null;
  callState.messageCounter = 0;
}