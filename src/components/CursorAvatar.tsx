/** The Dani avatar: the Bloub character (@norbert_bodziony/bloub, the Dani-Dex bot) behind this
 * app's long-standing CursorAvatar contract. The component's props, states, handle and catalog
 * re-exports are unchanged so every caller keeps working; the maus's cursor face is gone. App
 * states map onto Bloub states and expressions in bloub-adapter.ts, and each bot's saved color
 * still inks its character, so existing bots keep their identity on the new face. */
import React, { useEffect, useImperativeHandle, useRef } from 'react'

import {
  BotEngine,
  EXPRESSION_BY_ID,
  SHAPE_BY_ID,
  type BotFrame,
} from "@norbert_bodziony/bloub"

import { BLOUB_STATE, BLOUB_SHAPE, bloubExpressionAt } from "./bloub-adapter"
import {
  EXPRESSIONS,
  EXPRESSION_COUNT,
  FACE_BOX,
  FACE_CENTRE,
  GAZE,
  GAZE_TRAVEL,
  MOUTHS,
  MOUTH_STROKE,
  mouthFrame,
  type Ring,
} from "./cursor-face-data"
import { MOTION, bodyTransform, type BodyMotion } from "./mascot-motion"
import type { MascotBodyId } from "../../shared/mascot-bodies"

export { MOTION, bodyTransform }
export type { BodyMotion }
export {
  EXPRESSIONS,
  EXPRESSION_COUNT,
  FACE_BOX,
  FACE_CENTRE,
  GAZE,
  GAZE_TRAVEL,
  MOUTHS,
  MOUTH_STROKE,
  mouthFrame,
}
export type { Ring }

export const DEFAULT_GRADIENT: [string, string, string] = ["#C9CCF1", "#7C86E8", "#4B55C7"]

const VIEW_BOX = "-158 -158 316 316"
const SVG_NS = "http://www.w3.org/2000/svg"
const DEFAULT_INK = "#0a0a0c"

/** Stable seconds offset from a seed so every bot's character moves on its own clock. */
function phaseFromSeed(seed: string | number | undefined): number {
  if (seed === undefined) return Math.random() * 12
  const text = String(seed)
  let h = 2166136261
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) % 12000 / 1000
}

export type CursorState =
  | "sleeping"
  | "waking"
  | "idle"
  | "listening"
  | "thinking"
  | "searching"
  | "working"
  | "excited"
  | "surprised"
  | "suspicious"
  | "angry"
  | "drowsy"
  | "happy"
  | "curious"
  | "confused"
  | "bored"
  | "proud"
  | "shy"
  | "sad"
  | "laughing"
  | "scared"
  | "playful"
  | "celebrate"
  | "orbit"
  | "radar"
  | "progress"
  | "spawning"
  | "humming"
  | "loading"
  | "dictating"
  | "sending"
  | "receiving"
  | "uploading"
  | "writing"
  | "notifying"
  | "alerting"
  | "bouncing"
  | "dragging"
  | "powering-down"

export const POOLS = {
  sleeping: [
    22,
    13,
    4
  ],
  waking: [
    13
  ],
  idle: [
    6,
    0,
    8
  ],
  listening: [
    1,
    10,
    19
  ],
  thinking: [
    17,
    8,
    16,
    14,
    5
  ],
  searching: [
    20,
    15,
    9,
    3,
    12,
    18
  ],
  working: [
    10,
    7,
    16,
    11
  ],
  excited: [
    2,
    17,
    21,
    3,
    11
  ],
  surprised: [
    21,
    3
  ],
  suspicious: [
    5,
    14,
    23
  ],
  angry: [
    7,
    16
  ],
  drowsy: [
    22,
    4,
    13
  ],
  happy: [
    19,
    2,
    11,
    17
  ],
  curious: [
    21,
    3,
    0,
    15
  ],
  confused: [
    8,
    14,
    5
  ],
  bored: [
    0,
    4,
    22
  ],
  proud: [
    2,
    15,
    8
  ],
  shy: [
    24,
    0,
    13
  ],
  sad: [
    22,
    4,
    13
  ],
  laughing: [
    2,
    11,
    17
  ],
  scared: [
    21,
    3
  ],
  playful: [
    2,
    17,
    11,
    8
  ],
  celebrate: [
    2,
    8,
    17
  ],
  orbit: [
    6,
    0,
    8
  ],
  radar: [
    6,
    0,
    8
  ],
  progress: [
    6,
    0,
    8
  ],
  spawning: [
    3,
    0
  ],
  humming: [
    6,
    0,
    8
  ],
  loading: [
    6,
    0,
    8
  ],
  dictating: [
    1,
    10,
    19
  ],
  sending: [
    6,
    0,
    8
  ],
  receiving: [
    19,
    0,
    8
  ],
  uploading: [
    15,
    9,
    8
  ],
  writing: [
    15,
    9
  ],
  notifying: [
    21,
    3,
    0
  ],
  alerting: [
    21,
    3
  ],
  bouncing: [
    2,
    17
  ],
  dragging: [
    3,
    15,
    0
  ],
  "powering-down": [
    22,
    13
  ]
} satisfies Record<string, CursorState[]>

const isCursorState = (state: string): state is CursorState => state in POOLS
export const CURSOR_STATES = Object.keys(POOLS).filter(isCursorState)

export interface TrailSpec {
  count: number
  period: number
  radius: number
}

export interface GlyphSpec {
  markup: string
  period: number
  hold: number
}

export interface StateEffects {
  confetti?: ConfettiSpec
  trails?: TrailSpec
  glyph?: GlyphSpec
}

interface EffectsByState extends Partial<Record<CursorState, StateEffects>> {}

/** @deprecated old maus glyph artwork, kept only so EFFECTS' timing contract is intact. */
const GLYPH_BANG =
  '<path fill="{{GRADIENT}}" d="M99 58 Q99 43 114.3 43 Q129.6 43 129.6 58 L123 150 Q122 161 114.3 161 Q106.6 161 105.6 150 Z"/>' +
  '<circle fill="{{GRADIENT}}" cx="114.3" cy="188" r="15"/>'

const GLYPH_QUERY =
  '<path fill="none" stroke="{{GRADIENT}}" stroke-width="19" stroke-linecap="round" ' +
  'd="M88 76 A27 27 0 1 1 114.3 112 L114.3 132"/>' +
  '<circle fill="{{GRADIENT}}" cx="114.3" cy="170" r="13"/>'

export const EFFECTS: EffectsByState = {
  // Bounded by the viewBox's 15-unit margin: a piece thrown much past ~130 from centre is clipped mid-flight.
  celebrate: { confetti: { count: 16, period: 1500, life: 1300, origin: 74, spread: 54 } },
  excited: { confetti: { count: 9, period: 2000, life: 1100, origin: 72, spread: 44 } },
  laughing: { confetti: { count: 7, period: 2400, life: 1000, origin: 70, spread: 38 } },

  orbit: { trails: { count: 3, period: 2600, radius: 128 } },
  radar: { trails: { count: 2, period: 2000, radius: 132 } },
  progress: { trails: { count: 3, period: 1800, radius: 124 } },
  loading: { trails: { count: 2, period: 2200, radius: 126 } },
  uploading: { trails: { count: 2, period: 1700, radius: 122 } },
  sending: { trails: { count: 2, period: 1500, radius: 120 } },
  receiving: { trails: { count: 2, period: 1500, radius: 120 } },

  alerting: { glyph: { markup: GLYPH_BANG, period: 2600, hold: 1100 } },
  notifying: { glyph: { markup: GLYPH_BANG, period: 4200, hold: 900 } },
  confused: { glyph: { markup: GLYPH_QUERY, period: 5200, hold: 1200 } },
}



export type { CursorAvatarHandle }

export interface CursorAvatarProps {
  state?: CursorState
  expression?: number
  size?: number | string
  gaze?: { x?: number; y?: number }
  turn?: number
  lookAround?: number
  flip?: boolean
  spring?: number
  eyeScale?: number
  showMouth?: boolean
  mouthStroke?: number
  motion?: number
  effects?: boolean
  glyphs?: boolean
  autoBlink?: boolean
  autoExpression?: boolean
  paused?: boolean
  silhouette?: { id?: string }
  gradient?: [string, string, string]
  picture?: string | null
  eyeColor?: string
  /** Desynchronizes multiple avatars: each seed starts the character at a different point in its motion, like Dani-Dex's per-bot initialPhase. */
  phaseSeed?: string | number
  title?: string | null
  className?: string
  style?: React.CSSProperties
}

export interface CursorAvatarHandle {
  blink: () => void
  spin: (durationMs?: number) => void
  setExpression: (index: number) => void
}

function makeEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

/** Grow/shrink a pooled layer of paths to `count`. */
function pool(layer: SVGGElement, tag: "path" | "circle", count: number): SVGElement[] {
  while (layer.childNodes.length > count) layer.removeChild(layer.lastChild!)
  while (layer.childNodes.length < count) layer.appendChild(makeEl(tag))
  return Array.from(layer.childNodes) as SVGElement[]
}

export const CursorAvatar = React.forwardRef<CursorAvatarHandle, CursorAvatarProps>(
  function CursorAvatar(props, ref) {
    const {
      size = 160,
      title = null,
      className,
      style,
      gradient = DEFAULT_GRADIENT,
      eyeColor,
      paused = false,
    } = props
    const svgRef = useRef<SVGSVGElement>(null)
    const engineRef = useRef<BotEngine | null>(null)
    const pulseTimer = useRef<number | undefined>(undefined)
    const phaseRef = useRef(0)
    const propsRef = useRef(props)
    propsRef.current = props

    const pulse = (to: string, ms: number) => {
      const eng = engineRef.current
      if (!eng) return
      const phase = phaseRef.current
      const now = performance.now() / 1000 + phase
      eng.setState(to, now)
      window.clearTimeout(pulseTimer.current)
      pulseTimer.current = window.setTimeout(() => {
        const pose = BLOUB_STATE[(propsRef.current.state ?? "idle") as CursorState] ?? BLOUB_STATE.idle
        eng.setState(pose.state, performance.now() / 1000 + phaseRef.current)
      }, ms)
    }

    useImperativeHandle(ref, () => ({
      blink: () => pulse("wink", 700),
      spin: (durationMs = 900) => pulse("swirl", durationMs),
      setExpression: (index: number) => {
        const id = bloubExpressionAt(index)
        const expr = id ? EXPRESSION_BY_ID.get(id) : undefined
        if (expr) engineRef.current?.setExpression(expr, performance.now() / 1000 + phaseRef.current)
      },
    }))

    useEffect(() => {
      const svg = svgRef.current
      if (!svg) return
      const initial = BLOUB_STATE[(propsRef.current.state ?? "idle") as CursorState] ?? BLOUB_STATE.idle
      const phase = phaseFromSeed(propsRef.current.phaseSeed)
      phaseRef.current = phase
      const eng = new BotEngine(100, initial.state, null, initial.expression ? EXPRESSION_BY_ID.get(initial.expression) ?? null : null)
      eng.setState(initial.state, phase)
      engineRef.current = eng

      const arcsBack = makeEl("g", { fill: "none", "stroke-linecap": "round" })
      const dotsBack = makeEl("g")
      const body = makeEl("path")
      const eyesG = makeEl("g")
      const eyes = [makeEl("path"), makeEl("path")]
      for (const e of eyes) eyesG.appendChild(e)
      const notif = makeEl("g", { display: "none" })
      const notifDot = makeEl("circle")
      const notifNotch = makeEl("circle")
      notif.append(notifDot, notifNotch)
      const dotsFront = makeEl("g")
      const arcsFront = makeEl("g", { fill: "none", "stroke-linecap": "round" })
      svg.append(arcsBack, dotsBack, body, eyesG, notif, dotsFront, arcsFront)

      let lastFollowedState: CursorState | null = null
      let lastShapeId: string | undefined = undefined
      let lastLookKey = ""

      const apply = (frame: BotFrame, bodyColor: string, ink: string) => {
        body.setAttribute("d", frame.bodyPath)
        body.setAttribute("fill", bodyColor)
        body.setAttribute("opacity", String(frame.bodyAlpha))
        for (let i = 0; i < 2; i++) {
          const eye = frame.eyes[i]
          const el = eyes[i]
          if (!eye) { el.setAttribute("opacity", "0"); continue }
          el.setAttribute("d", eye.d)
          el.setAttribute("transform", eye.matrix)
          el.setAttribute("opacity", String(eye.alpha))
          el.setAttribute("fill", ink)
        }
        const drawDots = (layer: SVGGElement, dots: BotFrame["dots"]) => {
          while (layer.childNodes.length > dots.length) layer.removeChild(layer.lastChild!)
          dots.forEach((dot, i) => {
            const wantPath = !!dot.d
            let el = layer.childNodes[i] as SVGElement | undefined
            const isPath = el?.tagName === "path"
            if (!el || isPath !== wantPath) {
              el = makeEl(wantPath ? "path" : "circle")
              if (layer.childNodes[i]) layer.replaceChild(el, layer.childNodes[i])
              else layer.appendChild(el)
            }
            el.setAttribute("opacity", String(dot.opacity))
            el.setAttribute("fill", dot.color ?? bodyColor)
            if (wantPath) {
              el.setAttribute("d", dot.d!)
              el.setAttribute("transform", `translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(100)`)
            } else {
              el.setAttribute("cx", String(dot.x))
              el.setAttribute("cy", String(dot.y))
              el.setAttribute("r", String(dot.r))
            }
          })
        }
        drawDots(dotsBack, frame.dots.filter(() => frame.dotsBehind))
        drawDots(dotsFront, frame.dots.filter(() => !frame.dotsBehind))
        const drawArcs = (layer: SVGGElement, part: "front" | "back", arcs: BotFrame["arcs"]) => {
          const els = pool(layer, "path", arcs.length)
          arcs.forEach((arc, i) => {
            const el = els[i]
            el.setAttribute("d", part === "front" ? arc.front : arc.back)
            el.setAttribute("stroke", arc.grad?.stops?.[arc.grad.stops.length - 1] ?? bodyColor)
            el.setAttribute("stroke-width", String(arc.width))
            el.setAttribute("opacity", String(arc.opacity))
          })
        }
        drawArcs(arcsBack, "back", frame.arcs)
        drawArcs(arcsFront, "front", frame.arcs)
        if (frame.notif) {
          notif.removeAttribute("display")
          notifDot.setAttribute("cx", String(frame.notif.x))
          notifDot.setAttribute("cy", String(frame.notif.y))
          notifDot.setAttribute("r", String(frame.notif.r))
          notifDot.setAttribute("fill", bodyColor)
          if (frame.notch) {
            notifNotch.setAttribute("cx", String(frame.notch.x))
            notifNotch.setAttribute("cy", String(frame.notch.y))
            notifNotch.setAttribute("r", String(frame.notch.r))
            notifNotch.setAttribute("fill", bodyColor)
          }
        } else {
          notif.setAttribute("display", "none")
        }
      }

      const followProps = (now: number) => {
        const p = propsRef.current
        const wanted = BLOUB_STATE[(p.state ?? "idle") as CursorState] ?? BLOUB_STATE.idle
        if (lastFollowedState !== (p.state ?? "idle")) {
          lastFollowedState = (p.state ?? "idle") as CursorState
          eng.setState(wanted.state, now)
          eng.setExpression(wanted.expression ? EXPRESSION_BY_ID.get(wanted.expression) ?? null : null, now)
        }
        const bodyId = (p.silhouette?.id ?? undefined) as MascotBodyId | undefined
        const shapeKey = bodyId ?? ""
        if (shapeKey !== lastShapeId) {
          lastShapeId = shapeKey
          const mapped = bodyId ? BLOUB_SHAPE[bodyId] : undefined
          eng.setShape(mapped ? SHAPE_BY_ID.get(mapped)?.radii ?? null : null, now)
        }
        const g = p.gaze
        const lookKey = g ? `${(g.x ?? 0).toFixed(3)}:${(g.y ?? 0).toFixed(3)}:${p.lookAround ?? 1}` : ""
        if (lookKey !== lastLookKey) {
          lastLookKey = lookKey
          if (g && ((g.x ?? 0) !== 0 || (g.y ?? 0) !== 0)) {
            eng.setLook({ yaw: (g.x ?? 0) * 35, pitch: (g.y ?? 0) * 25, mix: 1, spin: 0, wander: p.lookAround ?? 0 }, now)
          } else {
            eng.setLook(null, now)
          }
        }
      }

      const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
      const still = paused || reduced
      if (still) {
        followProps(phase)
        apply(eng.sample(phase), gradient[1], eyeColor ?? DEFAULT_INK)
        return () => { engineRef.current = null }
      }

      let raf = 0
      const tick = (nowMs: number) => {
        const now = nowMs / 1000 + phase
        followProps(now)
        const p = propsRef.current
        apply(eng.sample(now), (p.gradient ?? DEFAULT_GRADIENT)[1], p.eyeColor ?? DEFAULT_INK)
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => {
        cancelAnimationFrame(raf)
        window.clearTimeout(pulseTimer.current)
        engineRef.current = null
      }
    }, [paused])

    return (
      <svg
        ref={svgRef}
        role="img"
        aria-label={title ?? undefined}
        viewBox={VIEW_BOX}
        width={size}
        height={size}
        className={className}
        style={style}
      >
        {title ? <title>{title}</title> : null}
      </svg>
    )
  },
)
