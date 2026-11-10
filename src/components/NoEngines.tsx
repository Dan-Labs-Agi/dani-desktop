import { useState } from "react";
import { WindowDragStrip } from "@/components/DesktopCapabilities";
import { ConnectAi } from "@/components/onboarding/ConnectAi";
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";

export function NoEngines() {
  const { refreshInstances } = useStore();
  const [rechecking, setRechecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const remoteClient = window.ogb?.remoteClient?.active === true;
  return <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-y-auto bg-app">
    <WindowDragStrip />
    <div className="mx-auto w-full max-w-[480px] px-6 py-12">
      <h1 className="text-[20px] font-semibold text-ink">{t(remoteClient ? "daniSetup.hostTitle" : "daniSetup.action")}</h1>
      <p className="mb-6 mt-2 text-[14px] leading-relaxed text-ink-secondary">
        {t(remoteClient ? "daniSetup.hostIntro" : "daniSetup.intro")}
      </p>
      {remoteClient ? <>
        <button type="button" disabled={rechecking} onClick={async () => {
          setRechecking(true); setFailed(false);
          try { await refreshInstances(); } catch { setFailed(true); } finally { setRechecking(false); }
        }} className="rounded-full bg-ink px-5 py-3 text-[14px] text-app disabled:opacity-60">{t(rechecking ? "common.checking" : "common.checkAgain")}</button>
        {failed && <p role="alert" className="mt-3 text-[13px] text-danger">{t("daniSetup.hostCheckFailed")}</p>}
      </> : <ConnectAi />}
    </div>
  </main>;
}
