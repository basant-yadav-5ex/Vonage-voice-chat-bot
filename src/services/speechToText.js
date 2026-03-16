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
  try {
    const tempDir = path.join(__dirname, "../../recordings");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Write audio to recordings file
    const wavFilePath = path.join(tempDir, `${utteranceId}.wav`);
    const audioBuffer = Buffer.from(audioBase64, "base64");
    fs.writeFileSync(wavFilePath, audioBuffer);

    console.log(`>> Calling Python Whisper on: ${wavFilePath}`);

    // Call Python script
    let stdout, stderr;
    try {
      const output = await execFileAsync("python3", [
        path.join(__dirname, "./pythonLibrarySTT.py"),
        wavFilePath
      ], { 
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024
      });
      stdout = output.stdout;
      stderr = output.stderr;
    } catch (execError) {
      console.error(`>> Python execution error:`, execError.message);
      console.error(`>> stdout:`, execError.stdout);
      console.error(`>> stderr:`, execError.stderr);
      throw execError;
    }

    console.log(`>> Python stdout: "${stdout}"`);
    if (stderr) console.log(`>> Python stderr: "${stderr}"`);

    // Parse JSON response
    let result;
    try {
      result = JSON.parse(stdout);
    } catch (parseError) {
      console.error(`>> JSON parse error:`, parseError.message);
      console.error(`>> Raw stdout:`, stdout);
      throw parseError;
    }
    
    if (!result.success) {
      throw new Error(result.error || "Transcription failed");
    }
    
    // Cleanup recordings file
    if (fs.existsSync(wavFilePath)) {
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
      const wavFilePath = path.join(tempDir, `${utteranceId}.wav`);
      if (fs.existsSync(wavFilePath)) {
        fs.unlinkSync(wavFilePath);
      }
    } catch (e) {}
    
    throw error;
  }
}
