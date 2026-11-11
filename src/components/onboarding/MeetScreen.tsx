import { useEffect, useMemo, useState } from "react";
import { ArrowUp, Plus } from "lucide-react";
import { BotAvatar } from "@/components/Avatar";
import { RobotAvatar } from "@/components/robot/RobotAvatar";
import { usePrefersReducedMotion } from "@/components/mascot-clock";
import { brand, productName } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { DEFAULT_BOT_NAME, myDefaultBot, useViewerEmail } from "@/lib/default-bot";
import { activeLocale, t } from "@/lib/i18n";
import { aiWorks } from "@/lib/onboarding";
import { useStore } from "@/state/store";
import { ConnectAiDialog, DaniSetup } from "./ConnectAi";
import { useWelcomeAi } from "./welcome-ai";
import { isDaniFreeInstance } from "../../../shared/dani-free";

const MASCOT_SIZE = 132;
const PLACEHOLDER_MS = 700;
const GRAPHEME_MS = 35;

function graphemes(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  return Segmenter ? Array.from(new Segmenter(activeLocale(), { granularity: "grapheme" }).segment(text), (part) => part.segment) : Array.from(text);
}

/** The demo's one sentence, typed once after the placeholder has been read; reduced motion shows it whole. */
function useDemoSentence(reduced: boolean): { text: string; typing: boolean; waiting: boolean } {
  const parts = useMemo(() => graphemes(t("onboarding.meet.demo")), []);
  const [typed, setTyped] = useState(reduced ? parts.length : -1);
  useEffect(() => {
    if (reduced || typed >= parts.length) return;
    const timer = setTimeout(() => setTyped((now) => now + 1), typed < 0 ? PLACEHOLDER_MS : GRAPHEME_MS);
    return () => clearTimeout(timer);
  }, [reduced, typed, parts.length]);
  const shown = reduced ? parts.length : typed;
  return { text: parts.slice(0, Math.max(0, shown)).join(""), typing: shown >= 0 && shown < parts.length, waiting: shown < 0 };
}

function DemoComposer({ reduced, onTyping }: { reduced: boolean; onTyping: (typing: boolean) => void }) {
  const { text, typing, waiting } = useDemoSentence(reduced);
  useEffect(() => onTyping(typing), [typing, onTyping]);
  return (
    <div aria-hidden="true" data-demo-composer=""
      className="absolute left-1/2 top-[calc(50%-14px)] flex min-h-[76px] w-[348px] max-w-[calc(100%-32px)] -translate-x-1/2 select-none flex-col gap-2.5 rounded-[22px] border-[0.5px] border-ink/10 bg-composer px-2 pb-2 pt-3 text-left [:root[data-skin=daylight]_&]:shadow-[0_2px_8px_-1px_rgb(0_0_0/0.05),0_1px_2px_rgb(0_0_0/0.03)]">
      <div className="mx-2 break-words text-[14px] leading-5">
        {waiting ? <span className="text-ink-tertiary">{t("onboarding.meet.placeholder", { app: productName() })}</span> : <span className="text-ink">{text}</span>}
        {!reduced && (waiting || typing) && <span className="animate-meet-caret ml-px inline-block h-[15px] w-[1.5px] translate-y-[2px] bg-ink align-[-2px]" />}
      </div>
      <div className="flex items-center justify-between">
        <span className="flex size-7 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-ink)_4%,var(--color-composer))] text-ink-tertiary"><Plus size={14} /></span>
        <span className="flex size-7 items-center justify-center rounded-full bg-ink text-app"><ArrowUp size={14} strokeWidth={2} /></span>
      </div>
    </div>
  );
}

/** The approved robot welcome keeps setup and consent on the first screen. */
export function MeetScreen({ hosted, replay = false, onNext }: { hosted: boolean; replay?: boolean; onNext: () => void }) {
  const { state } = useStore();
  const reduced = usePrefersReducedMotion();
  const dani = myDefaultBot(state.bots, useViewerEmail());
  const existing = replay || Boolean(state.config?.onboarding?.completedAt);
  const chosen = state.bots.find((bot) => bot.id === state.selectedId) ?? (existing ? dani : undefined);
  const explicit = chosen && (existing || !chosen.defaultBot || chosen.welcomed) ? chosen.modelSelection.instanceId : undefined;
  const candidates = hosted ? state.instances : state.instances.filter((instance) => isDaniFreeInstance(instance) || instance.instanceId === explicit);
  const tested = useWelcomeAi(candidates, !hosted);
  const ready = aiWorks(tested);
  const [dialog, setDialog] = useState(false);
  const [typing, setTyping] = useState(false);
  const logo = brand().logo;
  const face = typing ? "listening" : "idle";
  const signingIn = !hosted && !ready;
  return (
    <div className="relative h-full min-h-[600px] w-full text-center">
      <h1 id="welcome-title" className="absolute left-1/2 top-[calc(50%-264px)] w-max max-w-[min(560px,calc(100%-32px))] -translate-x-1/2 text-[28px] font-normal leading-[34px] tracking-[-0.02em] text-ink">
        {t("onboarding.meet.title", { app: productName() })}
      </h1>
      <span className="absolute left-1/2 top-[calc(50%-98px)] flex -translate-x-1/2 -translate-y-1/2" style={{ width: MASCOT_SIZE, height: MASCOT_SIZE }}>
        {logo ? (
          <img src={logo} alt="" width={MASCOT_SIZE} height={MASCOT_SIZE} className="size-full object-contain" />
        ) : dani ? (
          <BotAvatar bot={dani} size={MASCOT_SIZE} state={face} animated={!reduced} robotZoom={1.35} />
        ) : (
          <RobotAvatar variant="dani" size={MASCOT_SIZE} state={face} animated={!reduced} label={DEFAULT_BOT_NAME} zoom={1.35} />
        )}
      </span>
      <DemoComposer reduced={reduced} onTyping={setTyping} />
      {hosted && (
        <p className="absolute left-1/2 top-[calc(50%+86px)] w-[420px] max-w-[calc(100%-32px)] -translate-x-1/2 text-[13px] leading-[18px] text-ink-secondary">
          {t("onboarding.hosted.intro")}
        </p>
      )}
      <div className="absolute left-1/2 top-[calc(50%+130px)] flex w-[320px] max-w-[calc(100%-32px)] -translate-x-1/2 flex-col items-center pb-8">
        {signingIn ? (
          <DaniSetup compact />
        ) : (
          <button type="button" data-primary="" onClick={onNext} className={cn("ui-button ui-button-pill ui-button-lg ui-button-primary w-[288px] max-w-full", "animate-fade-in [animation-duration:150ms]")}>
            {t("onboarding.meet.next")}
          </button>
        )}
        {signingIn && (
          <p className="mt-3 text-[13px] leading-[18px] text-ink-secondary">
            <button type="button" onClick={() => setDialog(true)} className="rounded transition-colors hover:text-ink">{t("onboarding.meet.otherWays")}</button>
            <span aria-hidden="true"> · </span>
            <button type="button" data-welcome-later="" onClick={onNext} className="rounded transition-colors hover:text-ink">{t("onboarding.meet.setupLater")}</button>
          </p>
        )}
      </div>
      {dialog && <ConnectAiDialog hosted={hosted} onClose={() => setDialog(false)} />}
    </div>
  );
}
