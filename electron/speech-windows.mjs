import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Windows PowerShell 5.1, never PowerShell 7: System.Speech ships with .NET Framework only. */
export const WINDOWS_SPEECH_COMMAND = "powershell.exe";

export function windowsSpeechScript({ packaged, resourcesPath }) {
  return packaged ? path.join(resourcesPath, "speech-helper.ps1") : path.join(__dirname, "resources", "speech-helper.ps1");
}

/** whisper.cpp's CLI (with its sibling DLLs) and model, when both are on disk. */
export function windowsWhisper({ packaged, resourcesPath, env = process.env, exists = existsSync }) {
  const base = packaged ? resourcesPath : path.join(__dirname, "..", "dist-native");
  const cli = env.DANI_WHISPER_CLI || path.join(base, "speech-runtime", `win32-${process.arch}`, "whisper-cli.exe");
  const model = env.DANI_WHISPER_MODEL || path.join(base, "speech-models", "whisper", "ggml-base-q5_1.bin");
  const stream = path.join(path.dirname(cli), "whisper-stream.exe");
  return exists(cli) && exists(model) ? { cli, model, stream: exists(stream) ? stream : null } : null;
}

const join = (left, right) => left && right ? `${left} ${right}` : left || right;
// whisper.cpp writes non-speech as bracketed tags, and its base model hears these in near-silence.
const tidy = (text) => {
  const words = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  return /^(thank you\.?|thanks for watching!?|you\.?)$/i.test(words) ? "" : words;
};

/** whisper-stream redraws its current line after `\r` and keeps it on a line break (`\r\n` on Windows); returns the
 *  transcript so far after each stdout chunk. */
export function createWhisperStreamText() {
  let kept = "";
  let line = "";
  let held = "";
  return (chunk) => {
    const data = held + String(chunk);
    held = data.endsWith("\r") ? "\r" : "";
    for (const part of (held ? data.slice(0, -1) : data).split(/(\r\n|\r|\n)/)) {
      if (part === "\r\n" || part === "\n") {
        kept = join(kept, tidy(line));
        line = "";
      } else if (part === "\r") {
        line = "";
      } else {
        line += part;
      }
    }
    return join(kept, tidy(line));
  };
}

export const tidyWhisperText = tidy;

export function windowsSpeechArgs({ script, stopPath, finishPath, endpointMs = 0, whisper = null }) {
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-StopFile", stopPath, "-FinishFile", finishPath];
  if (endpointMs > 0) args.push("-EndpointMs", String(endpointMs));
  if (whisper) args.push("-WhisperCli", whisper.cli, "-WhisperModel", whisper.model);
  return args;
}

/** Feeds a helper's stdout chunks in and calls `onLine` with each complete JSON line; anything else is dropped. */
export function createJsonLines(onLine) {
  let buffer = "";
  return (chunk) => {
    buffer += String(chunk);
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object") onLine(parsed);
      } catch {
      }
    }
  };
}
