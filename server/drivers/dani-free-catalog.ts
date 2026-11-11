import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";
import { writeFileAtomic } from "../atomic.ts";
import type { ModelCatalog } from "../contracts.ts";

export const DANI_FREE_REFRESH_MS = 24 * 60 * 60 * 1000;
export const DANI_FREE_CATALOG_URLS = {
  kilo: "https://ai-gateway.kilo.ai/api/v1/models",
  opencode: "https://opencode.ai/inference/v1/models",
} as const;
export type DaniFreeSource = keyof typeof DANI_FREE_CATALOG_URLS;
const ROOT = join(DATA_DIR, "providers", "dani-free");
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const zero = (value: unknown): boolean => typeof value === "number" ? Number.isFinite(value) && value === 0
  : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) === 0;
const allZero = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return zero(value);
  const values = Object.values(value);
  return values.length > 0 && values.every(allZero);
};
const positive = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;

function expired(row: Record<string, unknown>, now: number): boolean {
  const expiry = row.expiration_date ?? row.expires_at ?? row.expiresAt;
  if (expiry === undefined || expiry === null) return false;
  if (typeof expiry !== "string") return true;
  const time = Date.parse(/^\d{4}-\d{2}-\d{2}$/u.test(expiry) ? `${expiry}T23:59:59.999Z` : expiry);
  return !Number.isFinite(time) || time <= now;
}

export function parseDaniFreeCatalog(source: DaniFreeSource, payload: unknown, now = Date.now()): ModelCatalog {
  const data = object(payload).data;
  if (!Array.isArray(data)) throw new Error("Dani free model catalog is malformed");
  const options: ModelCatalog["options"] = [];
  let concreteDefault = "";
  const seen: Record<string, true | undefined> = Object.create(null);
  for (const value of data) {
    const row = object(value);
    if (typeof row.id !== "string" || !row.id.trim() || /[\s\p{Cc}]/u.test(row.id) || seen[row.id] === true || expired(row, now)) continue;
    if (row.status !== undefined && row.status !== "active") continue;
    let tools: boolean;
    let imageInput: boolean;
    let contextWindow: number | undefined;
    if (source === "kilo") {
      const pricing = object(row.pricing);
      const architecture = object(row.architecture);
      if (row.isFree === false || !zero(pricing.prompt) || !zero(pricing.completion) || !allZero(pricing)) continue;
      if (row.type !== undefined && row.type !== "chat") continue;
      if (!Array.isArray(architecture.output_modalities) || !architecture.output_modalities.includes("text")) continue;
      if (!Array.isArray(architecture.input_modalities) || !architecture.input_modalities.includes("text")) continue;
      if (/(?:^|[/_-])(?:embed(?:ding)?|rerank(?:er)?|moderation|classifier|guard)(?:[/_-]|$)/iu.test(row.id)) continue;
      tools = Array.isArray(row.supported_parameters) && row.supported_parameters.includes("tools");
      imageInput = architecture.input_modalities.includes("image");
      contextWindow = positive(row.context_length) ?? positive(object(row.top_provider).context_length);
    } else {
      const cost = object(row.cost);
      const text = object(cost.text);
      const modalities = object(row.modalities);
      if (row.type !== "chat" || !zero(object(text.input).price) || !zero(object(text.output).price) || !allZero(cost)) continue;
      if (!Array.isArray(modalities.output) || !modalities.output.includes("text")) continue;
      tools = object(object(row.capabilities).tools).supported === true;
      imageInput = Array.isArray(modalities.input) && modalities.input.some((entry) => typeof entry === "string" && (entry === "image" || entry.startsWith("image/")));
      contextWindow = positive(object(row.limit).context);
    }
    seen[row.id] = true;
    if (!concreteDefault && !Array.isArray(object(row.autoRouting).models)) {
      concreteDefault = source === "opencode" ? `opencode/${row.id}` : row.id;
    }
    options.push({
      id: source === "opencode" ? `opencode/${row.id}` : row.id,
      label: typeof row.name === "string" && row.name.trim() ? row.name.trim() : row.id,
      tools, imageInput,
      ...(contextWindow ? { contextWindow } : {}),
      ...(typeof row.mayTrainOnYourPrompts === "boolean" ? { mayTrainOnYourPrompts: row.mayTrainOnYourPrompts } : {}),
      ...(typeof row.description === "string" ? { privacyNotice: row.description } : {}),
    });
  }
  return { default: concreteDefault || options[0]?.id || "", options };
}

function atomicJson(path: string, value: unknown, directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileAtomic(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

export function daniFreeActivated(root = ROOT): boolean {
  try { return object(JSON.parse(readFileSync(join(root, "activation.json"), "utf8"))).consented === true; }
  catch { return false; }
}

export function activateDaniFree(root = ROOT): void {
  atomicJson(join(root, "activation.json"), { consented: true }, root);
}

/** Owns the upstream evidence, not a startup cache's lossy display projection. */
export class DaniFreeCatalog {
  private payload: unknown = { data: [] };
  private checkedAt = 0;
  private pending: Promise<void> | undefined;
  private disposed = false;
  private controller = new AbortController();
  private timer: NodeJS.Timeout | undefined;
  private readonly root: string;
  private readonly path: string;
  private readonly now: () => number;
  private readonly source: DaniFreeSource;
  readonly startup: Promise<void>;
  error: string | undefined;

  constructor(source: DaniFreeSource, instanceId: string, options: { root?: string; now?: () => number; fetch?: typeof fetch; scheduleRefresh?: boolean } = {}) {
    this.source = source;
    this.root = options.root ?? ROOT;
    this.now = options.now ?? Date.now;
    this.fetcher = options.fetch ?? ((...args) => fetch(...args));
    this.path = join(this.root, `${encodeURIComponent(instanceId)}-${source}.json`);
    try {
      const cached = object(JSON.parse(readFileSync(this.path, "utf8")));
      parseDaniFreeCatalog(source, cached.payload, this.now());
      if (typeof cached.checkedAt === "number" && Number.isFinite(cached.checkedAt) && cached.checkedAt <= this.now()) {
        this.payload = cached.payload;
        this.checkedAt = cached.checkedAt;
      }
    } catch {}
    this.startup = this.stale ? this.refresh().catch(() => undefined) : Promise.resolve();
    if (options.scheduleRefresh !== false) {
      this.timer = setInterval(() => { void this.refresh().catch(() => undefined); }, DANI_FREE_REFRESH_MS);
      this.timer.unref?.();
    }
  }
  private readonly fetcher: typeof fetch;
  get stale(): boolean { return this.checkedAt === 0 || this.now() - this.checkedAt >= DANI_FREE_REFRESH_MS; }
  get successfulAt(): number { return this.checkedAt; }
  get models(): ModelCatalog {
    const parsed = parseDaniFreeCatalog(this.source, this.payload, this.now());
    return { ...parsed, options: parsed.options.map((option) => ({ ...option,
      availability: this.stale ? "unavailable" : "available",
      ...(this.stale ? { unavailableReason: "Free model eligibility needs a successful refresh." } : {}),
    })) };
  }
  refresh(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Dani free catalog is closed"));
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const response = await this.fetcher(DANI_FREE_CATALOG_URLS[this.source], {
          signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(20_000)]), redirect: "error",
        });
        if (!response.ok) throw new Error("Free model discovery is unavailable. Retry later.");
        const payload: unknown = await response.json();
        parseDaniFreeCatalog(this.source, payload, this.now());
        this.controller.signal.throwIfAborted();
        const checkedAt = this.now();
        atomicJson(this.path, { checkedAt, payload }, this.root);
        this.payload = payload;
        this.checkedAt = checkedAt;
        this.error = undefined;
      } catch (error) {
        this.error = "Free model discovery is unavailable. Retry later.";
        throw error;
      } finally { this.pending = undefined; }
    })();
    return this.pending;
  }
  async requireModel(id: string): Promise<ModelCatalog["options"][number]> {
    await this.startup;
    if (this.stale) await this.refresh();
    const model = this.models.options.find((option) => option.id === id);
    if (!model) throw new Error("The selected model is not currently eligible for free use. Choose a current free model.");
    return model;
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    clearInterval(this.timer);
    this.controller.abort();
    await this.pending?.catch(() => undefined);
  }
}
