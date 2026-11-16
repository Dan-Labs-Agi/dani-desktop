import { t } from "@/lib/i18n";

export type CallCapabilityHelp = {
  label: string;
  reason: string;
};

const turnsNeedMac = (): CallCapabilityHelp => ({
  label: t("call.capability.turnsNeedMac"),
  reason: t("call.capability.turnsNeedMacReason"),
});

const turnsOnThisComputer = (): CallCapabilityHelp => ({
  label: t("call.capability.turnsOnThisComputer"),
  reason: t("call.capability.turnsOnThisComputerReason"),
});

/** Calls where you take turns listen with Apple Speech. Windows' recognizer serves composer dictation only. */
export function turnCallsAvailable(capabilities: Pick<DesktopCapabilities, "dictation">): boolean {
  return capabilities.dictation.available && capabilities.dictation.engine !== "windows-speech";
}

export function callCapabilityHelp(
  capabilities: DesktopCapabilities,
  speechServiceAvailable: boolean,
): CallCapabilityHelp | null {
  if (!turnCallsAvailable(capabilities)) {
    if (capabilities.dictation.available) return turnsNeedMac();
    switch (capabilities.dictation.reasonCode) {
      case "remote-server":
        return capabilities.host.platform === "darwin" ? turnsOnThisComputer() : turnsNeedMac();
      case "desktop-app-required":
      case "unsupported-platform":
        return turnsNeedMac();
      default:
        return {
          label: t("call.capability.unavailable"),
          reason: t("call.capability.unavailableReason"),
        };
    }
  }
  if (!speechServiceAvailable) {
    return {
      label: t("call.capability.serviceUnavailable"),
      reason: t("call.capability.serviceUnavailableReason"),
    };
  }
  return null;
}
