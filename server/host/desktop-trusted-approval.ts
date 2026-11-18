import type { BotRecord, Store } from "../store.ts";
import type { ModelSelection } from "../contracts.ts";
import type { WireBot } from "../../shared/wire.ts";
import { approvalModeFor, isApprovalMode, isEmergencyApprovalDowngrade, type ApprovalMode } from "../../shared/approval-mode.ts";
import type { ProviderRegistry } from "../harness/registry.ts";

type ApprovalResponse = {
  type: "approval-trusted-mode-result" | "approval-trusted-mode-commit-result" | "approval-trusted-mode-confirm-result" | "approval-trusted-mode-activate-result" | "approval-trusted-mode-finalize-result";
  requestId: string; ok: boolean; bot?: WireBot; error?: string;
};

interface DesktopApprovalDeps {
  store: Pick<Store, "bot" | "tasks" | "projectBotForTask" | "patchBot" | "patchTask" | "switchTaskModel" | "refreshTaskPermissions" | "setAllThreadApprovalMode">;
  registry: Pick<ProviderRegistry, "cliTarget">;
  supportsApprovalMode(selection: ModelSelection | undefined, mode: ApprovalMode): boolean;
  postDesktopPrivateMessage(message: ApprovalResponse): boolean;
  wireBot(bot: BotRecord): WireBot;
  wireTrustedApprovalBot(bot: BotRecord): WireBot;
  stopBotForEmergencyApprovalDowngrade(botId: string): Promise<void>;
  checkedTaskModelSwitch(current: BotRecord, raw: unknown, updateBotDefault: boolean,
    resetApprovalToAsk: boolean, requireAvailableModel?: boolean, trusted?: boolean):
    { ok: true; selection: ModelSelection } | { ok: false; error: string };
  hostedModels: { resetTask(previous: ModelSelection, next: ModelSelection): Parameters<Store["switchTaskModel"]>[5] } | null;
  broadcast(frame: { kind: "bot"; bot: WireBot }): void;
}

/** Only Electron's private utility-process channel may deliver these transitions. */
export function createDesktopTrustedApprovalHandler(deps: DesktopApprovalDeps) {
  const { store, registry, supportsApprovalMode, postDesktopPrivateMessage, wireBot, wireTrustedApprovalBot,
    stopBotForEmergencyApprovalDowngrade, checkedTaskModelSwitch, hostedModels, broadcast } = deps;
  return function handleDesktopTrustedApprovalMessage(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const message = raw as Record<string, unknown>;
  const grantTarget = (bot: BotRecord) => bot.approvalGrant?.threadOnly
    ? store.projectBotForTask(bot.id, bot.approvalGrant.threadId!) : bot;
  const grantSupported = (bot: BotRecord, mode: ApprovalMode) => supportsApprovalMode(
    grantTarget(bot)?.modelSelection, mode) &&
    (!bot.approvalGrant?.allThreads || store.tasks(bot.id).every(task => supportsApprovalMode(
      task.modelSelection ?? bot.modelSelection, mode)));
  const clearGrant = (bot: BotRecord) => store.patchBot(bot.id, {
    ...(!bot.approvalGrant?.threadOnly ? { approvalMode: "ask" as const, autoApprove: false } : {}),
    approvalGrant: undefined,
  });
  const threadCanReceiveGrant = (bot: BotRecord): boolean => {
    const threadId = bot.approvalGrant?.threadId;
    if (!threadId) return true;
    const target = store.projectBotForTask(bot.id, threadId);
    return Boolean(target && (bot.approvalGrant?.threadOnly ||
      registry.cliTarget(target.modelSelection.instanceId)?.driverKind === registry.cliTarget(bot.modelSelection.instanceId)?.driverKind));
  };
  if (message.type === "approval-trusted-mode-commit") {
    const requestId = typeof message.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)
      ? message.requestId
      : null;
    const botId = typeof message.botId === "string" && /^[\w-]{1,128}$/.test(message.botId)
      ? message.botId
      : null;
    const mode = message.mode === "full" || message.mode === "custom" ? message.mode : null;
    if (!requestId) return true;
    if (!botId || !mode) return true;
    const bot = store.bot(botId);
    if (
      bot?.approvalGrant?.requestId === requestId &&
      bot.approvalGrant.mode === mode &&
      bot.approvalGrant.phase === "committed" &&
      (bot.approvalGrant.threadOnly || bot.approvalMode === mode) &&
      threadCanReceiveGrant(bot) &&
      grantSupported(bot, mode)
    ) {
      if (bot.approvalGrant.allThreads && mode === "full") {
        store.setAllThreadApprovalMode(botId, mode);
      } else if (bot.approvalGrant.refreshPermissions && bot.approvalGrant.threadId) {
        store.refreshTaskPermissions(botId, bot.approvalGrant.threadId);
      } else if (bot.approvalGrant.threadId) {
        store.patchTask(botId, bot.approvalGrant.threadId, { approvalMode: mode, autoApprove: false });
      }
      if (bot.approvalGrant) store.patchBot(botId, { approvalGrant: undefined });
      postDesktopPrivateMessage({ type: "approval-trusted-mode-commit-result", requestId, ok: true, bot: wireBot(store.bot(botId)!) });
    } else if (bot?.approvalGrant?.requestId === requestId) {
      clearGrant(bot);
      postDesktopPrivateMessage({ type: "approval-trusted-mode-commit-result", requestId, ok: false });
    } else {
      postDesktopPrivateMessage({ type: "approval-trusted-mode-commit-result", requestId, ok: false });
    }
    return true;
  }
  if (message.type === "approval-trusted-mode-confirm") {
    const requestId = typeof message.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)
      ? message.requestId
      : null;
    const botId = typeof message.botId === "string" && /^[\w-]{1,128}$/.test(message.botId)
      ? message.botId
      : null;
    const mode = message.mode === "full" || message.mode === "custom" ? message.mode : null;
    if (!requestId) return true;
    const confirm = (ok: boolean, error?: string) => {
      postDesktopPrivateMessage({
        type: "approval-trusted-mode-confirm-result",
        requestId,
        ok,
        ...(error ? { error } : {}),
      });
    };
    if (!botId || !mode) {
      confirm(false, "The approval confirmation was invalid");
      return true;
    }
    const bot = store.bot(botId);
    if (
      bot?.approvalGrant?.requestId === requestId &&
      bot.approvalGrant.mode === mode &&
      bot.approvalGrant.phase === "prepared" &&
      (bot.approvalGrant.threadOnly || bot.approvalMode === mode)
    ) {
      if (!grantSupported(bot, mode)) {
        clearGrant(bot);
        confirm(false, "This provider does not support the selected approval level");
        return true;
      }
      store.patchBot(botId, {
        approvalGrant: { ...bot.approvalGrant, requestId, mode, phase: "confirmed" },
      });
      confirm(true);
      return true;
    }
      // Ambiguous journal: revoke only this request, never a newer grant for the same bot.
    if (bot?.approvalGrant?.requestId === requestId) {
      clearGrant(bot);
    }
    confirm(false, "The approval confirmation no longer matches this bot");
    return true;
  }
  if (message.type === "approval-trusted-mode-activate") {
    const requestId = typeof message.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)
      ? message.requestId
      : null;
    const botId = typeof message.botId === "string" && /^[\w-]{1,128}$/.test(message.botId)
      ? message.botId
      : null;
    const mode = message.mode === "full" || message.mode === "custom" ? message.mode : null;
    if (!requestId) return true;
    const activate = (ok: boolean, error?: string) => {
      postDesktopPrivateMessage({
        type: "approval-trusted-mode-activate-result",
        requestId,
        ok,
        ...(error ? { error } : {}),
      });
    };
    if (!botId || !mode) {
      activate(false, "The approval activation was invalid");
      return true;
    }
    const bot = store.bot(botId);
    if (
      bot?.approvalGrant?.requestId === requestId &&
      bot.approvalGrant.mode === mode &&
      bot.approvalGrant.phase === "confirmed" &&
      (bot.approvalGrant.threadOnly || bot.approvalMode === mode)
    ) {
      if (!grantSupported(bot, mode)) {
        clearGrant(bot);
        activate(false, "This provider does not support the selected approval level");
        return true;
      }
      // Still inert until Electron acknowledges this and requests finalization.
      store.patchBot(botId, { approvalGrant: { ...bot.approvalGrant, requestId, mode, phase: "activated" } });
      activate(true);
      return true;
    }
    if (bot?.approvalGrant?.requestId === requestId) {
      clearGrant(bot);
    }
    activate(false, "The approval activation no longer matches this bot");
    return true;
  }
  if (message.type === "approval-trusted-mode-finalize") {
    const requestId = typeof message.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)
      ? message.requestId
      : null;
    const botId = typeof message.botId === "string" && /^[\w-]{1,128}$/.test(message.botId)
      ? message.botId
      : null;
    const mode = message.mode === "full" || message.mode === "custom" ? message.mode : null;
    if (!requestId) return true;
    const finalize = (ok: boolean, error?: string) => {
      postDesktopPrivateMessage({
        type: "approval-trusted-mode-finalize-result",
        requestId,
        ok,
        ...(error ? { error } : {}),
      });
    };
    if (!botId || !mode) {
      finalize(false, "The approval finalization was invalid");
      return true;
    }
    const bot = store.bot(botId);
    if (
      bot?.approvalGrant?.requestId === requestId &&
      bot.approvalGrant.mode === mode &&
      bot.approvalGrant.phase === "activated" &&
      (bot.approvalGrant.threadOnly || bot.approvalMode === mode) &&
      threadCanReceiveGrant(bot) &&
      grantSupported(bot, mode)
    ) {
      // Durable but still inert until Electron sends the commit release for this exact ACK.
      store.patchBot(botId, { approvalGrant: { ...bot.approvalGrant, requestId, mode, phase: "committed" } });
      finalize(true);
      return true;
    }
    if (bot?.approvalGrant?.requestId === requestId) {
      clearGrant(bot);
    }
    finalize(false, "The approval finalization no longer matches this bot");
    return true;
  }
  if (message.type !== "approval-trusted-mode-set") return false;
  const requestId = typeof message.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)
    ? message.requestId
    : null;
  if (!requestId) return true;
  const respond = (result: { ok: boolean; bot?: ReturnType<typeof wireBot>; error?: string }) => {
    postDesktopPrivateMessage({
      type: "approval-trusted-mode-result",
      requestId,
      ...result,
    });
  };
  const botId = typeof message.botId === "string" && /^[\w-]{1,128}$/.test(message.botId)
    ? message.botId
    : null;
  if (!botId) {
    respond({ ok: false, error: "The bot id is invalid" });
    return true;
  }
  const mode = isApprovalMode(message.mode) ? message.mode : null;
  if (!mode) {
    respond({ ok: false, error: "The approval mode is invalid" });
    return true;
  }
  const existing = store.bot(botId);
  if (!existing) {
    respond({ ok: false, error: "No such bot" });
    return true;
  }
  const currentMode = approvalModeFor(existing);
  const threadId = message.threadId;
  if (message.allThreads !== undefined && (typeof message.allThreads !== "boolean" ||
    (message.allThreads && (threadId !== undefined || message.threadOnly === true ||
      message.modelSelection !== undefined || message.updateBotDefault !== undefined ||
      mode === "custom")))) {
    respond({ ok: false, error: "Invalid all-threads approval scope" });
    return true;
  }
  if (message.allThreads === true && mode === "ask") {
    const updated = store.setAllThreadApprovalMode(botId, "ask")!;
    void stopBotForEmergencyApprovalDowngrade(botId).then(
      () => respond({ ok: true, bot: wireBot(store.bot(botId) ?? updated) }),
      () => respond({ ok: false, error: "Approval was reset to Ask, but an active turn could not be stopped" }),
    );
    return true;
  }
  if (message.allThreads === true && (existing.approvalGrant || store.tasks(botId).some(task =>
      !supportsApprovalMode(task.modelSelection ?? existing.modelSelection, mode)))) {
    respond({ ok: false, error: "Finish this bot's approval change first. Every thread's provider must support this approval level." });
    return true;
  }
  // Edits and Auto are not elevated: one write, no two-phase grant. Only this channel may move a team off Custom.
  if (message.allThreads === true && (mode === "edits" || mode === "auto")) {
    if (!supportsApprovalMode(existing.modelSelection, mode)) {
      respond({ ok: false, error: "This provider does not support the selected approval level" });
      return true;
    }
    if (mode === "auto" && existing.computer === "local" && message.acknowledgeLocalAuto !== true &&
      [existing, ...store.tasks(botId).map(task => store.projectBotForTask(botId, task.threadId) ?? {})].some(owner => approvalModeFor(owner) !== "auto")) {
      respond({ ok: false, error: "Auto mode on this computer requires confirming the warning" });
      return true;
    }
    store.setAllThreadApprovalMode(botId, mode);
    respond({ ok: true, bot: wireTrustedApprovalBot(store.bot(botId)!) });
    return true;
  }
  if (message.threadOnly !== undefined && typeof message.threadOnly !== "boolean") {
    respond({ ok: false, error: "Invalid thread approval scope" });
    return true;
  }
  if (message.refreshPermissions !== undefined && message.refreshPermissions !== true) {
    respond({ ok: false, error: "Invalid permission refresh" });
    return true;
  }
  if (message.refreshPermissions === true) {
    const target = typeof threadId === "string" ? store.projectBotForTask(botId, threadId) : null;
    const savedMode = approvalModeFor({ ...existing, approvalGrant: undefined });
    if (message.threadOnly !== true || !target || message.allThreads === true || message.modelSelection !== undefined || message.updateBotDefault !== undefined || savedMode !== mode) {
      respond({ ok: false, error: "Choose this bot's approval level in bot settings before refreshing a thread" });
      return true;
    }
    if (existing.approvalGrant) {
      respond({ ok: false, error: "Finish this bot's pending approval change first" });
      return true;
    }
    if (!supportsApprovalMode(target.modelSelection, mode)) {
      respond({ ok: false, error: "This thread's provider does not support that approval level" });
      return true;
    }
    if (mode === "auto" && target.computer === "local" && approvalModeFor(target) !== "auto" && message.acknowledgeLocalAuto !== true) {
      respond({ ok: false, error: "Auto mode on this computer requires confirming the warning" });
      return true;
    }
    if (mode === "full" || mode === "custom") {
      store.patchBot(botId, { approvalGrant: { requestId, mode, phase: "prepared", threadId: target.threadId, threadOnly: true, refreshPermissions: true } });
    } else if (!store.refreshTaskPermissions(botId, target.threadId)) {
      respond({ ok: false, error: "That thread is no longer available" });
      return true;
    }
    respond({ ok: true, bot: wireTrustedApprovalBot(store.bot(botId)!) });
    return true;
  }
  if (message.threadOnly === true) {
    const target = typeof threadId === "string" ? store.projectBotForTask(botId, threadId) : null;
    if (!target || message.modelSelection !== undefined || message.updateBotDefault !== undefined) {
      respond({ ok: false, error: "Choose an existing thread for this approval change" });
      return true;
    }
    // An ambiguous scoped grant may be cleared, but never a different grant.
    const clearsOwnGrant = mode === "ask" && existing.approvalGrant?.threadOnly && existing.approvalGrant.threadId === threadId;
    if (existing.approvalGrant && !clearsOwnGrant) {
      respond({ ok: false, error: "Finish this bot's pending approval change first" });
      return true;
    }
    if (!supportsApprovalMode(target.modelSelection, mode)) {
      respond({ ok: false, error: "This thread's provider does not support that approval level" });
      return true;
    }
    if (mode === "auto" && target.computer === "local" && approvalModeFor(target) !== "auto" && message.acknowledgeLocalAuto !== true) {
      respond({ ok: false, error: "Auto mode on this computer requires confirming the warning" });
      return true;
    }
    if (mode === "full" || mode === "custom") {
      store.patchBot(botId, { approvalGrant: { requestId, mode, phase: "prepared", threadId: target.threadId, threadOnly: true } });
    } else {
      if (clearsOwnGrant) clearGrant(existing);
      store.patchTask(botId, target.threadId, { approvalMode: mode, autoApprove: mode === "auto", alwaysAllow: [] });
    }
    respond({ ok: true, bot: wireTrustedApprovalBot(store.bot(botId)!) });
    return true;
  }
  if (message.modelSelection !== undefined) {
    const target = typeof threadId === "string" ? store.projectBotForTask(botId, threadId) : null;
    if (mode !== "ask" || !target || typeof message.updateBotDefault !== "boolean") {
      respond({ ok: false, error: "A confirmed model switch must select a thread and Ask permissions" });
      return true;
    }
    const checked = checkedTaskModelSwitch(target, message.modelSelection, message.updateBotDefault, true, false, true);
    if (!checked.ok) { respond({ ok: false, error: checked.error }); return true; }
    try {
      store.switchTaskModel(botId, threadId as string, checked.selection, message.updateBotDefault, true,
        hostedModels?.resetTask(target.modelSelection, checked.selection));
      const fresh = { ...wireBot(store.bot(botId)!), approvalMode: approvalModeFor(store.bot(botId)!) };
      broadcast({ kind: "bot", bot: fresh });
      respond({ ok: true, bot: fresh });
    } catch {
      respond({ ok: false, error: "The model switch could not be saved. No settings were changed." });
    }
    return true;
  }
  if (threadId !== undefined) {
    const target = typeof threadId === "string" && /^[\w-]{1,128}$/.test(threadId)
      ? store.projectBotForTask(botId, threadId) : null;
    if (!target || (mode !== "full" && mode !== "custom") || currentMode !== mode || existing.approvalGrant) {
      respond({ ok: false, error: "Choose this bot's approval level in bot settings before applying it to an existing thread" });
      return true;
    }
    if (registry.cliTarget(target.modelSelection.instanceId)?.driverKind !== registry.cliTarget(existing.modelSelection.instanceId)?.driverKind) {
      respond({ ok: false, error: "Use the bot's provider on this thread before applying its approval level" });
      return true;
    }
  }
  const emergencyDowngrade = existing.busy && isEmergencyApprovalDowngrade(currentMode, mode);
  if (!supportsApprovalMode(existing.modelSelection, mode)) {
    respond({ ok: false, error: "Custom approval settings are available only for Codex bots" });
    return true;
  }
  if (
    mode === "auto" &&
    existing.computer === "local" &&
    approvalModeFor(existing) !== "auto" &&
    message.acknowledgeLocalAuto !== true
  ) {
    respond({ ok: false, error: "Auto mode on this computer requires confirming the warning" });
    return true;
  }
  const updated = store.patchBot(botId, {
    approvalMode: mode,
    autoApprove: mode === "auto",
    approvalGrant: mode === "full" || mode === "custom"
      ? { requestId, mode, phase: "prepared", ...(typeof threadId === "string" ? { threadId } : {}), ...(message.allThreads === true ? { allThreads: true } : {}) }
      : undefined,
  });
  if (!updated) {
    respond({ ok: false, error: "No such bot" });
    return true;
  }
  if (emergencyDowngrade) {
    // Fail closed: persist Ask before the first await, and answer only once the interrupt is issued so Electron cannot advance a newer selection meanwhile.
    void stopBotForEmergencyApprovalDowngrade(updated.id).then(
      () => respond({ ok: true, bot: wireBot(store.bot(updated.id) ?? updated) }),
      (error) => respond({
        ok: false,
        error: `Approval was reset to Ask, but the active turn could not be stopped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }),
    );
    return true;
  }
  respond({ ok: true, bot: wireTrustedApprovalBot(updated) });
  return true;
}
;
}
