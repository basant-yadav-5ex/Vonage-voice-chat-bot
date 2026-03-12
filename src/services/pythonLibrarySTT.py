import whisper
import sys
import json
import os

# Suppress warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

if len(sys.argv) < 2:
    sys.stdout.write(json.dumps({"text": "", "success": False})+'\n')
    sys.exit(1)

audio_path = sys.argv[1]

try:
    # Load model
    model = whisper.load_model("base")
    
    # Transcribe
    result = model.transcribe(audio_path)
    
    text = result.get("text", "").strip() if result else ""
    
    # Output ONLY JSON
    sys.stdout.write(json.dumps({
        "text": text,
        "success": True
    }) + '\n')
    sys.stdout.flush()
    
except Exception as e:
    sys.stdout.write(json.dumps({
        "text": "",
        "success": False,
        "error": str(e)
    }) + '\n')
    sys.stdout.flush()
    sys.exit(1)
