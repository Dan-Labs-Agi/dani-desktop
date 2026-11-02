/** Maps this app's avatar vocabulary onto the Bloub character (@norbert_bodziony/bloub, the
 * Dani-Dex bot). The app's 39 cursor states pick a Bloub pose (body motion) plus a default face,
 * and the app's 10 mascot bodies pick the closest Bloub silhouette. Bloub's declared TypeScript
 * unions lag its runtime catalog, so the ids below are the runtime-verified ones (STATES /
 * EXPRESSIONS / SHAPES exported by the package) kept as plain strings on purpose. */
import type { MascotBodyId } from "../../shared/mascot-bodies"
import type { CursorState } from "./CursorAvatar"

interface BloubPose {
  /** Runtime Bloub state id: idle|thinking|wink|wide|alert|notify|exclaim|sleep|egg|hexagon|play|orbit|swirl|burst|comet. */
  state: string
  /** Runtime Bloub expression id, shown when the state's pose keeps the base face. */
  expression?: string
}

export const BLOUB_STATE: Record<CursorState, BloubPose> = {
  idle: { state: "idle" },
  thinking: { state: "thinking" },
  searching: { state: "thinking", expression: "curieux" },
  working: { state: "play", expression: "attentif" },
  writing: { state: "play", expression: "heureux" },
  excited: { state: "wide", expression: "excite" },
  celebrate: { state: "burst", expression: "hilare" },
  proud: { state: "idle", expression: "fier" },
  curious: { state: "egg", expression: "curieux" },
  listening: { state: "idle", expression: "attentif" },
  suspicious: { state: "idle", expression: "mefiant" },
  confused: { state: "hexagon", expression: "confus" },
  surprised: { state: "wide", expression: "surpris" },
  scared: { state: "wide", expression: "effraye" },
  drowsy: { state: "idle", expression: "somnolent" },
  sleeping: { state: "sleep" },
  angry: { state: "idle", expression: "colere" },
  sad: { state: "idle", expression: "triste" },
  shy: { state: "idle", expression: "timide" },
  bored: { state: "idle", expression: "blase" },
  dizzy: { state: "orbit" },
  love: { state: "wink", expression: "heureux" },
  wink: { state: "wink" },
  notifying: { state: "notify" },
  alerting: { state: "alert" },
  radar: { state: "orbit" },
  sending: { state: "comet", expression: "heureux" },
  receiving: { state: "comet", expression: "attentif" },
  uploading: { state: "comet", expression: "excite" },
  downloading: { state: "comet", expression: "curieux" },
  speaking: { state: "play", expression: "hilare" },
  recording: { state: "idle", expression: "attentif" },
  dragging: { state: "swirl" },
  bouncing: { state: "play", expression: "hilare" },
  "powering-down": { state: "sleep" },
  bluetooth: { state: "notify", expression: "curieux" },
  calling: { state: "notify", expression: "attentif" },
  muted: { state: "exclaim", expression: "triste" },
  paused: { state: "idle", expression: "blase" },
  error: { state: "exclaim", expression: "colere" },
}

/** App body shapes onto Bloub silhouettes; null keeps Bloub's default body. */
export const BLOUB_SHAPE: Record<MascotBodyId, string | null> = {
  cursor: null,
  blob: "galet",
  circle: "cercle",
  squircle: "squircle",
  capsule: "capsule",
  drop: "goutte",
  shield: "goutte",
  hexagon: "hexagone",
  diamond: "triangle",
  star: "hexagone",
}

/** Old 24-slot face catalog onto Bloub's 16 expressions, order preserved for saved indexes. */
const BLOUB_EXPRESSIONS: string[] = [
  "neutre",
  "heureux",
  "hilare",
  "surpris",
  "excite",
  "curieux",
  "fier",
  "somnolent",
  "triste",
  "colere",
  "mefiant",
  "confus",
  "attentif",
  "effraye",
  "timide",
  "blase",
  "neutre",
  "heureux",
  "hilare",
  "surpris",
  "excite",
  "curieux",
  "fier",
  "somnolent",
]

export function bloubExpressionAt(index: number): string | undefined {
  return BLOUB_EXPRESSIONS[index]
}
