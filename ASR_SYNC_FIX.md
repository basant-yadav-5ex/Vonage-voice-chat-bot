# ASR Audio & Text Synchronization Fix

## Problem
Audio completion and ASR text results were not synchronized, causing incomplete messages:
- Audio finishes capturing from WebSocket
- ASR webhook arrives with text transcription
- But timing wasn't guaranteed - one could arrive before the other

## Solution: Timeout-Based Synchronization

### Key Changes

#### 1. **NCCO Configuration** (`src/ncco/ncco.js`)
- ✅ Set `saveAudio: true` to get `recording_url` from Vonage
- Vonage now provides official audio recording in ASR response

#### 2. **State Management** (`src/state/callState.js`)
- Added `asrTimeoutId` to track waiting timeout
- Allows graceful fallback if audio doesn't arrive in time

#### 3. **ASR Controller** (`src/controllers/asrController.js`)
```
Timeline:
T+0    → User starts speaking
T+2    → Speech ends, ASR webhook fires with text results
T+2.5  → (Optional) WebSocket completes audio processing
         
→ Wait max 3 seconds for audio
→ If audio arrives: emit with both audio + text
→ If timeout: emit with text + recording_url from Vonage
```

**Flow:**
1. ASR webhook arrives with `speech.results` (text) and `speech.recording_url` (if saveAudio=true)
2. Store text in `pendingText` with `recordingUrl`
3. Check if audio already in `pendingAudio`:
   - YES → Emit immediately with both
   - NO → Set 3-second timeout waiting for audio
4. If timeout expires → Emit with Vonage's `recording_url` instead

#### 4. **WebSocket Handler** (`src/websocket/vonageWs.js`)
- When audio finishes capturing, check if `pendingText` exists
- If text ready → Emit immediately
- If text not ready → Wait for ASR webhook
- Clear timeout if both arrive before deadline

### Voice-Message Emission

**Event structure:**
```javascript
{
  id: "utterance_id",
  text: "cleaned transcribed text",
  audio: "base64 WAV data from WebSocket",  // or null if timeout
  recordingUrl: "https://api.nexmo.com/v1/files/...",  // from Vonage
  timestamp: 1234567890,
  isComplete: true,
  source: "websocket" or "asr"  // which came first
}
```

### Debugging Logs
Console logs now show:
```
>> ASR webhook received
>> Text confidence: 0.9405097
>> pendingAudio exists? true/false
>> pendingAudio.isComplete? true/false
>> Audio already ready, emitting voice-message immediately
// OR
>> Waiting for audio to arrive from WebSocket (max 3 seconds)
// OR
>> Audio ready but no text yet. Waiting for ASR webhook response...
```

## Testing

1. **Case 1: Audio arrives first**
   - Audio captured → stored in pendingAudio
   - Wait for ASR text → arrives within 3 seconds
   - Both ready → emit immediately

2. **Case 2: Text arrives first**
   - ASR webhook returns text → stored in pendingText
   - Wait for audio → max 3 seconds
   - Both ready → emit immediately

3. **Case 3: Timeout**
   - Text arrives but audio never comes (WebSocket lag/failure)
   - 3-second timeout expires
   - Emit with Vonage's `recording_url` instead

## Backwards Compatibility
- Still captures audio via WebSocket (preferred)
- Falls back to Vonage's `recording_url` (reliable)
- Old code expecting audio in `voice-message` still works
- New field `recordingUrl` available for fallback case
