import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Transcribe audio using Python Whisper library
 */
export async function transcribeAudio(audioBase64, utteranceId) {
  const tempDir = path.join(__dirname, "../../recordings");
  const wavFilePath = path.join(tempDir, `${utteranceId}.wav`);
  const keepRecordings = String(process.env.KEEP_RECORDINGS || "").toLowerCase() === "true";

  try {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Write audio to recordings file
    const audioBuffer = Buffer.from(audioBase64, "base64");
    fs.writeFileSync(wavFilePath, audioBuffer);

    if (!fs.existsSync(wavFilePath)) {
      throw new Error(`WAV write failed (file missing): ${wavFilePath}`);
    }

    const fileStats = fs.statSync(wavFilePath);
    console.log(`>> WAV size: ${fileStats.size} bytes`);
    if (fileStats.size < 1024) {
      throw new Error(`Audio too short (${fileStats.size} bytes)`);
    }

    console.log(`>> Calling Python Whisper on: ${wavFilePath}`);

    const defaultPython = process.platform === "win32" ? "python" : "python3";
    const pythonBin = process.env.PYTHON_BIN || defaultPython;
    const timeoutMs = Number(process.env.WHISPER_TIMEOUT_MS || 180000);
    const maxBuffer = 10 * 1024 * 1024;
    console.log(`>> Using Python bin: ${pythonBin}`);
    console.log(`>> Whisper timeout: ${timeoutMs}ms`);

    const runWhisper = async () => {
      let stdout, stderr;
      let execFailure = null;
      try {
        const output = await execFileAsync(pythonBin, [
          path.join(__dirname, "./pythonLibrarySTT.py"),
          wavFilePath
        ], { 
          timeout: timeoutMs,
          maxBuffer
        });
        stdout = output.stdout;
        stderr = output.stderr;
      } catch (execError) {
        execFailure = execError;
        stdout = execError.stdout || "";
        stderr = execError.stderr || "";
        console.error(`>> Python execution error:`, execError.message);
        if (execError.code !== undefined) {
          console.error(`>> Python exit code:`, execError.code);
        }
        if (execError.signal) {
          console.error(`>> Python signal:`, execError.signal);
        }
        if (stdout) console.error(`>> stdout:`, stdout);
        if (stderr) console.error(`>> stderr:`, stderr);
      }
      return { stdout, stderr, execFailure };
    };

    let { stdout, stderr, execFailure } = await runWhisper();
    if (execFailure?.signal === "SIGTERM") {
      console.warn(">> Whisper SIGTERM detected. Retrying once after 1500ms...");
      await new Promise((r) => setTimeout(r, 1500));
      ({ stdout, stderr, execFailure } = await runWhisper());
    }

    console.log(`>> Python stdout: "${stdout}"`);
    if (stderr) console.log(`>> Python stderr: "${stderr}"`);

    // Parse JSON response
    let result;
    try {
      result = JSON.parse(stdout || "{}");
    } catch (parseError) {
      console.error(`>> JSON parse error:`, parseError.message);
      console.error(`>> Raw stdout:`, stdout);
      throw parseError;
    }
    
    if (!result.success) {
      const fallback = execFailure?.message || (stderr ? stderr.trim() : "");
      throw new Error(result.error || fallback || "Transcription failed");
    }
    
    // Cleanup recordings file
    if (!keepRecordings && fs.existsSync(wavFilePath)) {
      fs.unlinkSync(wavFilePath);
    }

    console.log(`>> Python Whisper done: "${result.text}"`);

    return {
      text: result.text || "",
      confidence: 0.95,
      source: "whisper-python"
    };
  } catch (error) {
    console.error(`>> Whisper error: ${error.message}`);
    
    // Cleanup on error
    try {
      if (!keepRecordings && fs.existsSync(wavFilePath)) {
        fs.unlinkSync(wavFilePath);
      }
    } catch (e) {}
    
    throw error;
  }
}
