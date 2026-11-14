import { describe, expect, it } from "vitest";
import { createSpeechTranscript } from "./speech-transcript.mjs";
import { createJsonLines, windowsSpeechArgs, windowsSpeechScript } from "./speech-windows.mjs";

describe("the Windows speech helper", () => {
  it("runs the script under Windows PowerShell with the session's stop and finish markers", () => {
    const args = windowsSpeechArgs({ script: "C:\app\speech-helper.ps1", stopPath: "C:\t\stop", finishPath: "C:\t\finish" });
    expect(args).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "C:\app\speech-helper.ps1", "-StopFile", "C:\t\stop", "-FinishFile", "C:\t\finish"]);
    expect(windowsSpeechArgs({ script: "s", stopPath: "a", finishPath: "b", endpointMs: 900 }).slice(-2)).toEqual(["-EndpointMs", "900"]);
  });

  it("is read from the app's resources once packaged, since PowerShell cannot open a file inside the archive", () => {
    expect(windowsSpeechScript({ packaged: true, resourcesPath: "/res" }).replaceAll("\\", "/")).toBe("/res/speech-helper.ps1");
    expect(windowsSpeechScript({ packaged: false, resourcesPath: "/res" }).replaceAll("\\", "/")).toMatch(/electron\/resources\/speech-helper\.ps1$/);
  });

  it("splits stdout into JSON lines across chunk boundaries and drops what is not JSON", () => {
    const lines = [];
    const feed = createJsonLines((line) => lines.push(line));
    feed('{"partial":true,"te');
    feed('xt":"hello"}\r\nnot json\n\n{"partial":false,"text":"hello there"}\n{"error":"micro');
    expect(lines).toEqual([{ partial: true, text: "hello" }, { partial: false, text: "hello there" }]);
    feed('phone-unavailable"}\n');
    expect(lines.at(-1)).toEqual({ error: "microphone-unavailable" });
  });

  it("emits whole-transcript lines the shared transcript passes through unchanged", () => {
    const transcript = createSpeechTranscript();
    expect(transcript({ partial: true, text: "open the" }).text).toBe("open the");
    expect(transcript({ partial: true, text: "open the report" }).text).toBe("open the report");
    expect(transcript({ partial: true, text: "open the report and send it" }).text).toBe("open the report and send it");
    expect(transcript({ partial: false, text: "open the report and send it" })).toEqual({ partial: false, text: "open the report and send it" });
  });
});
