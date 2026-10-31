import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { CHROME_GRADIENT, MAUS_COLORS, type MausColor, type MausMotion, type MausState } from "@/lib/mascot";
import { avatarCropRadius, botAvatarProfile, clampAvatarFocus, clampAvatarZoom, type BotAvatarCrop, type MascotFaceColor } from "../../shared/bot-avatar";
import type { BotBodyId } from "../../shared/bot-body";
import { RobotAvatar } from "./manzanilla/RobotAvatar";
import type { RobotMotion, RobotRole } from "./manzanilla/robot-model";
import type { CursorAvatarHandle } from "./CursorAvatar";
import { botRobotRole } from "@/lib/robot-role";

export const EYE_SCALE = 1.12;
export const MOUTH_WEIGHT = 11;




export type MausAvatarHandle = CursorAvatarHandle;

export type MausAvatarProps = {
  color: MausColor;
  state?: MausState;
  expression?: number;
  size?: number;
  label?: string;
  motion?: MausMotion;
  motionKey?: number;
  turn?: number;
  gaze?: { x?: number; y?: number };
  spring?: number;
  eyeScale?: number;
  showMouth?: boolean;
  mouthStroke?: number;
  forward?: boolean;
  lookAround?: number;
  trackPointer?: boolean;
  animated?: boolean;
  bodyId?: BotBodyId;
  gradient?: [string, string, string];
  faceColor?: MascotFaceColor | null;
  robotRole?: RobotRole;
};

export function roomAvatarGradient(color: MausColor): [string, string, string] {
  const fill = `var(--identity-${color})`;
  return [
    `color-mix(in srgb, ${fill} 82%, #ffffff)`,
    fill,
    `color-mix(in srgb, ${fill} 82%, #000000)`,
  ];
}

/** One-shot Maus motions that have a real Manzanilla equivalent; the rest idle. */
const MOTION_TO_ROBOT: Partial<Record<MausMotion, RobotMotion>> = {
  celebrate: "celebrate",
  success: "cheer",
  blink: "blink",
};

function MausAvatarComponent(
  {
    color,
    state = "idle",
    size = 44,
    label,
    motion = "none",
    motionKey = 0,
    animated = true,
    robotRole,
  }: MausAvatarProps,
  ref: React.Ref<MausAvatarHandle>,
) {
  // Every bot wears its dani-dex Manzanilla character. Shape bodies, costume
  // picks, face plates, gaze and gradient props are still accepted so callers
  // keep compiling; the robot supersedes them all.
  const [blinkKey, setBlinkKey] = useState(0);
  useImperativeHandle(ref, () => ({
    blink: () => setBlinkKey((key) => key + 1),
    spin: () => {},
    setExpression: () => {},
  }));
  // Chrome is a three-stop gradient; the single-color robot wears its mid-tone.
  const hex = color === "chrome" ? CHROME_GRADIENT[1] : MAUS_COLORS[color];
  const oneShot = MOTION_TO_ROBOT[motion];
  // The robot knows working/waiting families; "listening" keeps its waiting pose.
  const robotState = state === "listening" ? "waiting" : state;
  return (
    <RobotAvatar
      size={size}
      label={label ?? "Dani Bot"}
      color={hex}
      role={robotRole}
      state={robotState}
      animated={animated}
      motion={oneShot ?? (blinkKey ? "blink" : undefined)}
      motionKey={oneShot ? motionKey : blinkKey}
    />
  );
}

export const MausAvatar = memo(forwardRef(MausAvatarComponent));

export type BotAvatarProps = Omit<MausAvatarProps, "color" | "gradient"> & {
  readable?: boolean;
  bot: {
    name?: string;
    title?: string | null;
    readyBotId?: string | null;
    chiefOfStaff?: boolean | null;
    color: MausColor;
    avatarUrl?: string | null;
    avatarCrop?: BotAvatarCrop;
    avatarZoom?: number;
    avatarFocusX?: number;
    avatarFocusY?: number;
    mascotBody?: BotBodyId | null;
    mascotFaceColor?: MascotFaceColor | null;
  };
};

export type BotAvatarOutcome = "flatImage" | "gradientMascot";

/** Mirrored name for name by resolveBotAvatarOutcome in ios/Sources/CompanionCore/BotAvatarRendering.swift. */
export function resolveBotAvatarOutcome(params: {
  avatarCrop: BotAvatarCrop;
  hasUrl: boolean;
  imageFailed: boolean;
}): BotAvatarOutcome {
  const { avatarCrop, hasUrl, imageFailed } = params;
  if (!hasUrl) return "gradientMascot";
  if (avatarCrop === "mascot") return "gradientMascot";
  if (imageFailed) return "gradientMascot";
  return "flatImage";
}

export function BotAvatar({ bot, size = 44, label, readable: _readable = false, ...mascotProps }: BotAvatarProps) {
  const profile = botAvatarProfile(bot);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [profile.avatarUrl]);

  const outcome = resolveBotAvatarOutcome({
    avatarCrop: profile.avatarCrop,
    hasUrl: Boolean(profile.avatarUrl),
    imageFailed,
  });

  if (outcome !== "flatImage") {
    return (
      <MausAvatar
        {...mascotProps}
        color={bot.color}
        robotRole={botRobotRole(bot)}
        size={size}
        label={label ?? bot.name}
      />
    );
  }

  const radius = avatarCropRadius(profile.avatarCrop);
  const zoom = clampAvatarZoom(bot.avatarZoom ?? 1);
  const focusX = clampAvatarFocus(bot.avatarFocusX ?? 0.5);
  const focusY = clampAvatarFocus(bot.avatarFocusY ?? 0.5);
  const origin = `${focusX * 100}% ${focusY * 100}%`;
  return (
    <span
      className="relative block shrink-0 overflow-hidden bg-raised"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <img
        src={profile.avatarUrl}
        alt={label ?? (bot.name ? `${bot.name} avatar` : "Bot avatar")}
        width={size}
        height={size}
        draggable={false}
        onError={() => setImageFailed(true)}
        className="block size-full max-w-none object-cover"
        style={{
          width: size,
          height: size,
          objectPosition: origin,
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
          transformOrigin: origin,
        }}
      />
    </span>
  );
}

export function InitialsAvatar({
  initials,
  avatarUrl,
  size = 32,
  fallback,
  fontSize,
  className,
}: {
  initials: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
  /** drawn instead of the initials, for a person with no name or email to take them from */
  fallback?: ReactNode;
  fontSize?: number;
}) {
  // A picture that is gone (a restored backup carries the address, not the file) falls back to the initials.
  const [failed, setFailed] = useState<string | null>(null);
  if (avatarUrl && failed !== avatarUrl) {
    return <img src={avatarUrl} alt="" onError={() => setFailed(avatarUrl)} className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />;
  }
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary font-medium", className)}
      style={{ width: size, height: size, fontSize: fontSize ?? size * 0.38 }}
    >
      {fallback ?? initials}
    </div>
  );
}
