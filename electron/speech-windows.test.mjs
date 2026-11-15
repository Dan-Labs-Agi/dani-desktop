import { describe, expect, it } from "vitest";
import { createSpeechTranscript } from "./speech-transcript.mjs";
import { createJsonLines, createWhisperStreamText, tidyWhisperText, windowsSpeechArgs, windowsSpeechScript, windowsWhisper } from "./speech-windows.mjs";

describe("the Windows speech helper", () => {
  it("runs the script under Windows PowerShell with the session's stop and finish markers", () => {
    const args = windowsSpeechArgs({ script: "C:\app\speech-helper.ps1", stopPath: "C:\t\stop", finishPath: "C:\t\finish" });
    expect(args).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "C:\app\speech-helper.ps1", "-StopFile", "C:\t\stop", "-FinishFile", "C:\t\finish"]);
    expect(windowsSpeechArgs({ script: "s", stopPath: "a", finishPath: "b", endpointMs: 900 }).slice(-2)).toEqual(["-EndpointMs", "900"]);
  });

  it("hands the helper whisper.cpp only when both its CLI and model are on disk", () => {
    const env = { DANI_WHISPER_CLI: "C:/w/whisper-cli.exe", DANI_WHISPER_MODEL: "C:/w/model.bin" };
    const whisper = windowsWhisper({ packaged: false, env, exists: () => true });
    expect(whisper).toMatchObject({ cli: env.DANI_WHISPER_CLI, model: env.DANI_WHISPER_MODEL });
    expect(whisper.stream.replaceAll("\\", "/")).toBe("C:/w/whisper-stream.exe");
    expect(windowsWhisper({ packaged: false, env, exists: (file) => !file.endsWith("whisper-stream.exe") }).stream).toBeNull();
    expect(windowsWhisper({ packaged: false, env, exists: (file) => file !== env.DANI_WHISPER_MODEL })).toBeNull();
    expect(windowsWhisper({ packaged: true, resourcesPath: "/res", env: {}, exists: () => true }).model.replaceAll("\\", "/")).toBe("/res/speech-models/whisper/ggml-base-q5_1.bin");
    expect(windowsSpeechArgs({ script: "s", stopPath: "a", finishPath: "b", whisper }).slice(-4)).toEqual(["-WhisperCli", env.DANI_WHISPER_CLI, "-WhisperModel", env.DANI_WHISPER_MODEL]);
  });

  it("is read from the app's resources once packaged, since PowerShell cannot open a file inside the archive", () => {
    expect(windowsSpeechScript({ packaged: true, resourcesPath: "/res" }).replaceAll("\\", "/")).toBe("/res/speech-helper.ps1");
    expect(windowsSpeechScript({ packaged: false, resourcesPath: "/res" }).replaceAll("\\", "/")).toMatch(/electron\/resources\/speech-helper\.ps1$/);
  });

  it("reads whisper-stream's redrawn lines into the transcript so far, without its tags or silence fillers", () => {
    const text = createWhisperStreamText();
    const clear = `\x1b[2K\r${" ".repeat(100)}\x1b[2K\r`;
    expect(text(`[Start speaking]\r\n${clear} Thank you.`)).toBe("");
    expect(text(`${clear} send the quarterly`)).toBe("send the quarterly");
    expect(text(`${clear} send the quarterly report to the team\r`)).toBe("send the quarterly report to the team");
    expect(text(`\n${clear} by Friday`)).toBe("send the quarterly report to the team by Friday");
    expect(text(`${clear} [BLANK_AUDIO]`)).toBe("send the quarterly report to the team");
    expect(tidyWhisperText(" Thank you. ")).toBe("");
    expect(tidyWhisperText("Thank you for the report.")).toBe("Thank you for the report.");
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
