// Resolve compatibility before importing anything that can open profile state.
import { app, dialog } from "electron";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { profileDecision, PROFILE_CHOICE_PREFIX } from "./profile-compatibility.mjs";

let decision;
try {
  const choices = process.argv.filter(value => value.startsWith(PROFILE_CHOICE_PREFIX));
  decision = profileDecision({ platform: process.platform, packaged: app.isPackaged, appData: app.getPath("appData"), current: app.getPath("userData"), choice: choices.length === 1 ? choices[0].slice(PROFILE_CHOICE_PREFIX.length) : null });
} catch {
  dialog.showErrorBox("Could not open a profile safely", "A profile folder could not be checked. Neither profile was opened. Check its permissions and reopen Dani Bot.");
  app.exit(1);
}
if (decision?.kind === "choose") {
  // Chromium must not initialize either ambiguous profile while the dialog runs.
  const chooser = mkdtempSync(path.join(os.tmpdir(), "dani-profile-chooser-"));
  app.setPath("userData", chooser);
  app.setPath("sessionData", chooser);
  await app.whenReady();
  const { response } = await dialog.showMessageBox({
    type: "question", title: "Choose your existing profile", message: "Two Dani Bot profiles exist. Which should open?",
    detail: `Established profile:\n${decision.established}\n\nNewer profile:\n${decision.current}\n\nNothing will be moved, merged or deleted. Saved sign-ins may still need permission to unlock. You will be asked again when both profiles exist.`,
    buttons: ["Open established profile", "Open newer profile", "Quit"], defaultId: 2, cancelId: 2, noLink: true,
  });
  if (response === 0 || response === 1) {
    const args = process.argv.slice(1).filter(value => !value.startsWith(PROFILE_CHOICE_PREFIX));
    app.relaunch({ args: [...args, PROFILE_CHOICE_PREFIX + (response === 0 ? "established" : "current")] });
  }
  app.exit(0);
} else if (decision) {
  if (decision.path !== app.getPath("userData")) {
    app.setPath("userData", decision.path);
    app.setPath("sessionData", decision.path);
  }
  await import("./main.mjs");
}
