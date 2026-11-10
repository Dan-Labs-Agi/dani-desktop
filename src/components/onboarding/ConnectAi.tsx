import { useRef, useState } from "react";
import { Check, ChevronDown, LoaderCircle, X } from "lucide-react";
import { EngineSetup } from "@/components/EngineSetup";
import { InstanceProviderMark } from "@/components/ProviderIcons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { organisationSignIn, plainSignIn } from "@/lib/onboarding";
import { configuredModelInstances } from "@/lib/engine-rail";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { api, useStore, type InstanceInfo } from "@/state/store";
import { DANI_FREE_INSTANCE_ID, DANI_FREE_CLIENT_INSTANCE_ID, DANI_FREE_INSTANCE_IDS } from "../../../shared/dani-free";
import { OrganisationRow } from "./beats/OrganisationRow";

type Preparation = "idle" | "preparing" | "ready" | "failed";
type InstancesResponse = { instances?: InstanceInfo[] };
const FREE_ROUTES = [DANI_FREE_INSTANCE_ID, DANI_FREE_CLIENT_INSTANCE_ID];

function freeRouteCanRun(instance: InstanceInfo | undefined): boolean {
  return Boolean(instance && !instance.policy && instance.snapshot.state === "available" && instance.snapshot.authenticated !== false
    && instance.models.options.some((option) => !option.orgBlocked && (option.availability === undefined || option.availability === "available")));
}

/** Consent happens here before either route is activated or sent a test prompt. */
export function DaniSetup({ compact = false }: { compact?: boolean }) {
  const { state, dispatch } = useStore();
  const [routes, setRoutes] = useState<Record<string, Preparation>>(() => Object.fromEntries(FREE_ROUTES.map((id) => {
    const instance = state.instances.find((candidate) => candidate.instanceId === id);
    return [id, instance?.aiTest === "passed" && freeRouteCanRun(instance) ? "ready" : "idle"];
  })));
  const running = useRef(false);
  const allowed = FREE_ROUTES.filter((id) => !state.instances.find((instance) => instance.instanceId === id)?.policy);
  const busy = allowed.some((id) => routes[id] === "preparing");
  const ready = allowed.some((id) => routes[id] === "ready");
  const failed = allowed.some((id) => routes[id] === "failed");
  const complete = allowed.length > 0 && allowed.every((id) => routes[id] === "ready");

  const prepare = async () => {
    if (running.current || allowed.length === 0) return;
    running.current = true;
    let fleet = state.instances;
    const updateFleet = (response: InstancesResponse) => {
      if (!response.instances) return;
      fleet = response.instances;
      dispatch({ type: "instances", instances: fleet });
    };
    setRoutes(Object.fromEntries(FREE_ROUTES.map((id) => [id, allowed.includes(id) ? "preparing" : "idle"])));
    try {
      const results: [string, Preparation][] = [];
      for (const id of FREE_ROUTES) {
        let result: Preparation = "failed";
        const instance = fleet.find((candidate) => candidate.instanceId === id);
        if (instance?.policy) {
          results.push([id, "idle"]);
          setRoutes((current) => ({ ...current, [id]: "idle" }));
          continue;
        }
        try {
          const path = `/api/instances/${encodeURIComponent(id)}`;
          const installed = await api<InstancesResponse>(`${path}/install`, { method: "POST", timeoutMs: 180_000 });
          updateFleet(installed);
          const installedInstance = fleet.find((candidate) => candidate.instanceId === id);
          if (installedInstance && !installedInstance.policy) {
            const refreshed = await api<InstancesResponse>(`${path}/refresh-models`, { method: "POST", timeoutMs: 30_000 });
            updateFleet(refreshed);
            if (freeRouteCanRun(fleet.find((candidate) => candidate.instanceId === id))) {
              const answer = await api<{ ok?: boolean | null }>(`${path}/check`, { method: "POST", body: "{}", timeoutMs: 120_000 });
              result = answer.ok === true ? "ready" : "failed";
            }
          }
        } catch {
          result = "failed";
        }
        results.push([id, result]);
        setRoutes((current) => ({ ...current, [id]: result }));
      }
      try {
        const refreshed = await api<InstancesResponse>("/api/instances", { signal: AbortSignal.timeout(10_000) });
        updateFleet(refreshed);
      } catch {
      }
      for (const result of results) {
        if (!freeRouteCanRun(fleet.find((candidate) => candidate.instanceId === result[0]))) result[1] = "failed";
      }
      setRoutes(Object.fromEntries(results));
    } finally {
      running.current = false;
    }
  };

  return (
    <div data-dani-setup className={cn("flex w-full min-w-0 flex-col gap-3", !compact && "rounded-2xl bg-card p-4 text-left")}>
      {!compact && <h3 className="text-[14px] font-medium text-ink">{t("daniSetup.group")}</h3>}
      <p className="text-[12px] leading-[18px] text-ink-secondary">
        {t("daniSetup.disclosure")}
      </p>
      {state.instances.map((instance) => DANI_FREE_INSTANCE_IDS[instance.instanceId] === true && instance.policy && (
        <p key={instance.instanceId} role="status" className="text-[12px] leading-[18px] text-ink-secondary">
          {t("policy.managedBy", { organization: instance.policy.organizationName })} · {instance.policy.reason.replace(/\b(?:OpenCode(?:\s+Zen)?|Kilo(?:Code)?)\b/gi, t("daniSetup.freeService"))}
        </p>
      ))}
      {ready && <p role="status" className="flex items-center justify-center gap-1.5 text-[13px] text-success"><Check size={14} aria-hidden="true" />{t("daniSetup.ready")}</p>}
      {failed && <p role="alert" className="text-[13px] leading-[18px] text-warning">{t(ready ? "daniSetup.partial" : "daniSetup.failed")}</p>}
      {!complete && <button type="button" data-primary disabled={busy || allowed.length === 0} onClick={() => void prepare()}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-[14px] font-medium text-app transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60">
        {busy && <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {t(busy ? "daniSetup.preparing" : failed ? "daniSetup.retry" : "daniSetup.action")}
      </button>}
    </div>
  );
}

function OtherWay({ instance, open, onToggle }: { instance: InstanceInfo; open: boolean; onToggle: () => void }) {
  const signedOut = instance.snapshot.authenticated === false;
  return <div>
    <button type="button" onClick={onToggle} aria-expanded={open}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink/[0.04] focus-visible:outline-offset-[-2px]">
      <InstanceProviderMark instance={instance} size={18} />
      <span className="min-w-0 flex-1 text-[14px] text-ink"><span className="block truncate">{instance.displayName}</span>{signedOut && <span className="text-[12px] text-ink-secondary">{t("model.signInRequired")}</span>}</span>
      <ChevronDown size={14} className={cn("shrink-0 text-ink-secondary", open && "rotate-180")} />
    </button>
    {open && <EngineSetup instance={instance} intent={instance.access === "custom" ? "inject" : "cloud"}
      {...(plainSignIn(instance) ? { description: t("onboarding.engines.signInHint", { name: instance.displayName }) } : {})} className="mx-4 mb-3.5 border-0 bg-inset" />}
  </div>;
}

export function ConnectAi({ hosted = false }: { hosted?: boolean }) {
  const { state, dispatch } = useStore();
  const organisation = organisationSignIn(window.ogb, { hosted });
  const [open, setOpen] = useState<string | null>(null);
  const installed = configuredModelInstances(state.instances).filter((instance) => DANI_FREE_INSTANCE_IDS[instance.instanceId] !== true && instance.snapshot.state === "available" && instance.install && instance.access !== "api");
  return <div className="flex w-full flex-col gap-3">
    <DaniSetup />
    {(organisation || installed.length > 0) && <div className="w-full divide-y divide-hairline/40 overflow-hidden rounded-2xl bg-card text-left">
      {organisation && <OrganisationRow bridge={organisation} onOpenSettings={() => dispatch({ type: "toggleAppSettings", open: true, section: "organization" })} onConnected={() => {
        void api<InstancesResponse>("/api/instances", { signal: AbortSignal.timeout(10_000) }).then((result) => {
          if (result.instances) dispatch({ type: "instances", instances: result.instances });
        }).catch(() => {});
      }} />}
      {installed.map((instance) => <OtherWay key={instance.instanceId} instance={instance} open={open === instance.instanceId} onToggle={() => setOpen(open === instance.instanceId ? null : instance.instanceId)} />)}
    </div>}
  </div>;
}

export function ConnectAiDialog({ hosted = false, onClose }: { hosted?: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useModalDialog(dialog, onClose);
  return <div className="ui-scrim fixed inset-0 z-[60] flex items-center justify-center p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="connect-ai-title" data-connect-ai=""
      className="ui-modal animate-pop-in motion-reduce:animate-none flex max-h-[min(640px,calc(100vh-32px))] w-[440px] max-w-full flex-col overflow-hidden text-left">
      <div className="flex h-[52px] shrink-0 items-center justify-between pl-4 pr-3">
        <h2 id="connect-ai-title" className="text-[14px] font-semibold leading-[22px] text-ink">{t("daniSetup.action")}</h2>
        <button type="button" autoFocus onClick={onClose} aria-label={t("common.close")} title={t("common.close")} className="flex size-7 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/[0.06] hover:text-ink"><X size={16} /></button>
      </div>
      <div className="ui-modal-divider shrink-0" />
      <div className="min-h-0 overflow-y-auto p-4 [scrollbar-width:thin]"><ConnectAi hosted={hosted} /></div>
    </div>
  </div>;
}
