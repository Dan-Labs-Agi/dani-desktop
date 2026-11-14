import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Windows PowerShell 5.1, never PowerShell 7: System.Speech ships with .NET Framework only. */
export const WINDOWS_SPEECH_COMMAND = "powershell.exe";

export function windowsSpeechScript({ packaged, resourcesPath }) {
  return packaged ? path.join(resourcesPath, "speech-helper.ps1") : path.join(__dirname, "resources", "speech-helper.ps1");
}

export function windowsSpeechArgs({ script, stopPath, finishPath, endpointMs = 0 }) {
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-StopFile", stopPath, "-FinishFile", finishPath];
  if (endpointMs > 0) args.push("-EndpointMs", String(endpointMs));
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
