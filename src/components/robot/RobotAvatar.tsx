import { useEffect, useRef, useState } from "react";

import {
  greetAvatar,
  inferRobotRole,
  motionDuration,
  motionFromState,
  pokeAvatar,
  registerAvatar,
  resolveRobotColor,
  seedFromLabel,
  type AvatarInstance,
  type RobotMotion,
  type RobotRole,
} from "./robot-avatar-engine";
import type { DaniVariantId } from "./dani-variants";
import "./robot-avatar.css";

export type RobotAvatarProps = {
  size?: number;
  label: string;
  color?: string;
  /** A Dani character variant; overrides role/color when set. */
  variant?: DaniVariantId;
  role?: RobotRole;
  state?: string;
  animated?: boolean;
  motion?: RobotMotion;
  className?: string;
  motionKey?: string | number;
};

/** React adapter around the Manzanilla model and its shared 30fps renderer. */
export function RobotAvatar(props: RobotAvatarProps) {
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const instanceRef = useRef<AvatarInstance | null>(null);
  const previousMotionKey = useRef(props.motionKey);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const label = typeof props.label === "string" && props.label.trim() ? props.label : "AI agent";
  const role = props.role ?? inferRobotRole(label);
  const size = Number.isFinite(props.size) ? Math.max(16, Math.min(props.size ?? 64, 1024)) : 64;
  const color = resolveRobotColor(role, props.color);
  const motion = props.motion ?? motionFromState(props.state);
  const animated = props.animated ?? true;

  useEffect(() => {
    const element = elementRef.current;
    const canvas = canvasRef.current;
    if (!element || !canvas) return;
    setReady(false);
    setFailure(null);
    const instance: AvatarInstance = {
      element,
      canvas,
      context: canvas.getContext("2d"),
      size,
      role,
      variant: props.variant,
      color,
      motion,
      animated,
      seed: seedFromLabel(label),
      visible: false,
      dirty: true,
      ready: false,
      waveStarted: null,
      motionStarted: null,
      motionCompleted: false,
      onReady: (next) => {
        setReady(next);
        if (next) setFailure(null);
      },
      onFailure: setFailure,
    };
    if (!instance.context) setFailure("3D avatar cannot display: canvas drawing is unavailable.");
    instanceRef.current = instance;
    const unregister = registerAvatar(instance);
    const owner = element.closest('button, a[href], [role="button"], [tabindex]') ?? element;
    const greet = () => greetAvatar(instance);
    owner.addEventListener("pointerenter", greet);
    owner.addEventListener("focusin", greet);
    return () => {
      owner.removeEventListener("pointerenter", greet);
      owner.removeEventListener("focusin", greet);
      instanceRef.current = null;
      unregister();
    };
  }, [size, label, role, props.variant, color, motion, animated]);

  useEffect(() => {
    if (props.motionKey === previousMotionKey.current) return;
    previousMotionKey.current = props.motionKey;
    const instance = instanceRef.current;
    if (!instance) return;
    if (motionDuration(instance.motion) > 0) {
      instance.motionStarted = null;
      instance.motionCompleted = false;
      pokeAvatar(instance);
    } else {
      greetAvatar(instance);
    }
  }, [props.motionKey]);

  return (
    <span
      ref={elementRef}
      className={`mz-robot-avatar${ready ? " is-ready" : ""}${props.className ? ` ${props.className}` : ""}`}
      style={{ width: `${size}px`, height: `${size}px` }}
      role="img"
      aria-label={failure ? `${label}. 3D avatar unavailable.` : label}
      title={failure ?? label}
      data-robot-error={failure ?? undefined}
      data-robot-role={props.variant ?? role}
      data-robot-motion={motion}
      data-robot-renderer={ready ? "webgl" : failure ? "unavailable" : "loading"}
    >
      <span className="mz-robot-placeholder" aria-hidden="true">
        {failure ? "3D unavailable" : "Loading 3D"}
      </span>
      <canvas ref={canvasRef} className="mz-robot-canvas" />
      {failure ? (
        <span className="mz-robot-error" aria-hidden="true">
          !
        </span>
      ) : null}
    </span>
  );
}
