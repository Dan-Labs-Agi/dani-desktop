import { useCallback, useEffect, useRef, useState } from "react";
import { aiSignInKey, type AiTestState } from "../../../shared/ai-ranking";
import { engineReady } from "@/components/EngineLibrary";
import { welcomeAi } from "@/lib/onboarding";
import { api, type InstanceInfo } from "@/state/store";
import { DANI_FREE_INSTANCE_IDS } from "../../../shared/dani-free";
import { t } from "@/lib/i18n";

type Answer = { ok?: boolean | null; error?: string } | undefined;
type Known = { state: AiTestState; error?: string };

const keyOf = (instance: InstanceInfo) => `${instance.instanceId}\n${aiSignInKey(instance.snapshot)}`;
/** A free catalog is not activation or a working connection. */
const runs = (instance: InstanceInfo) => !instance.policy && engineReady(instance) && (DANI_FREE_INSTANCE_IDS[instance.instanceId] === true
  ? instance.models.options.some((option) => !option.orgBlocked && option.id.trim() && (option.availability === undefined || option.availability === "available"))
  : Boolean(instance.models.default.trim() || instance.models.options.some((option) => option.id.trim())));

export type WelcomeAiNow = NonNullable<ReturnType<typeof welcomeAi<InstanceInfo>>> & {
  /** The plain reason its test failed, when it gave one (signed out, a used-up limit…). */
  error?: string;
  /** Check again: one more test message. */
  retry(): void;
};

/** Existing agents keep their check behavior. Free routes require a successful answer. */
export function useWelcomeAi(instances: readonly InstanceInfo[], enabled = true): WelcomeAiNow | null {
  const [answers, setAnswers] = useState<Record<string, Known>>({});
  const asked = useRef(new Set<string>());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const ask = useCallback((key: string) => {
    if (asked.current.has(key)) return;
    asked.current.add(key);
    const instanceId = key.slice(0, key.indexOf("\n"));
    void api<Answer>(`/api/instances/${encodeURIComponent(instanceId)}/check`, { method: "POST", body: "{}", timeoutMs: 120_000 })
      .then((answer): Known => answer?.ok === true ? { state: "passed" } : answer?.ok === false
        ? { state: "failed", ...(answer.error ? { error: DANI_FREE_INSTANCE_IDS[instanceId] === true ? t("daniSetup.checkFailed") : answer.error } : {}) }
        : { state: DANI_FREE_INSTANCE_IDS[instanceId] === true ? "failed" : "untestable" },
        (): Known => ({ state: DANI_FREE_INSTANCE_IDS[instanceId] === true ? "failed" : "untestable" }))
      .then((known) => {
        asked.current.delete(key);
        if (live.current) setAnswers((current) => ({ ...current, [key]: known }));
      });
  }, []);
  const known = (instance: InstanceInfo): Known | undefined => {
    const result = answers[keyOf(instance)]
      ?? (instance.aiTest && instance.aiTest !== "testing" ? { state: instance.aiTest, ...(instance.aiTestError ? { error: instance.aiTestError } : {}) } : undefined);
    if (DANI_FREE_INSTANCE_IDS[instance.instanceId] === true && result?.state === "untestable") return { state: "failed" };
    return result;
  };
  const found = welcomeAi(instances, runs, (instance) => known(instance)?.state);
  const asking = enabled && found?.state === "testing" ? keyOf(found.instance) : null;
  useEffect(() => {
    if (asking) ask(asking);
  }, [asking, ask]);
  if (!found) return null;
  const key = keyOf(found.instance);
  const error = found.state === "failed" ? known(found.instance)?.error : undefined;
  return {
    ...found,
    ...(error ? { error } : {}),
    retry: () => {
      if (!enabled) return;
      setAnswers((current) => ({ ...current, [key]: { state: "testing" } }));
      ask(key);
    },
  };
}
