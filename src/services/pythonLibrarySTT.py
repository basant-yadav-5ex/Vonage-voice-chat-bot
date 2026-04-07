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
model_name = os.environ.get("WHISPER_MODEL", "tiny")
backend = os.environ.get("WHISPER_BACKEND", "faster").lower()
compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

try:
    use_faster = False
    if backend in ("faster", "auto"):
        try:
            from faster_whisper import WhisperModel
            use_faster = True
        except Exception:
            use_faster = False

    if not use_faster:
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

    if use_faster:
        # Faster-Whisper (CTranslate2) is significantly quicker on CPU
        model = WhisperModel(model_name, device="cpu", compute_type=compute_type)
        segments, info = model.transcribe(
            audio_path,
            beam_size=1,
            vad_filter=True
        )
        text = " ".join([seg.text.strip() for seg in segments]).strip()
    else:
        # Standard Whisper
        model = whisper.load_model(model_name)
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
