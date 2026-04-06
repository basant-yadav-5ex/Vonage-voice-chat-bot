import sys
import json
import os

# Suppress warnings early (before heavy imports)
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
import warnings
warnings.filterwarnings("ignore", message="FP16 is not supported on CPU; using FP32 instead")

if len(sys.argv) < 2:
    sys.stdout.write(json.dumps({"text": "", "success": False})+'\n')
    sys.exit(1)

audio_path = sys.argv[1]

try:
    try:
        import whisper
    except Exception as import_err:
        sys.stdout.write(json.dumps({
            "text": "",
            "success": False,
            "error": f"Import error: {str(import_err)}"
        }) + '\n')
        sys.stdout.flush()
        sys.exit(1)

    if not os.path.exists(audio_path):
        sys.stdout.write(json.dumps({
            "text": "",
            "success": False,
            "error": f"Audio file not found: {audio_path}"
        }) + '\n')
        sys.stdout.flush()
        sys.exit(1)

    # Load model
    model = whisper.load_model("base")
    
    # Transcribe
    result = model.transcribe(audio_path, fp16=False)
    
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
