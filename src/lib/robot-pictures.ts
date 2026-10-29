// Dani's own 3D robot character as finished pictures, baked from the DaniDex Three.js rig:
// src/assets/dani-robot/<color>-<pose>-<px>.webp, square, framing the whole character, at <px>
// device pixels. Poses are the rig's four states; colors are its preset shells. A color with no
// pictures keeps the drawn mascot finish.
const files = import.meta.glob<string>("../assets/dani-robot/*.webp", { eager: true, query: "?url", import: "default" });

export type RobotColor = "blue" | "pink" | "teal" | "violet";
export type RobotPose = "idle" | "working" | "waiting" | "replied";

export interface RobotImage { color: RobotColor; pose: RobotPose; px: number; url: string }

export const ROBOT_IMAGES: readonly RobotImage[] = Object.entries(files)
  .flatMap(([path, url]) => {
    const match = /\/(blue|pink|teal|violet)-(idle|working|waiting|replied)-(\d+)\.webp$/.exec(path);
    return match ? [{ color: match[1] as RobotColor, pose: match[2] as RobotPose, px: Number(match[3]), url }] : [];
  })
  .sort((a, b) => a.px - b.px);

/** The smallest picture that still has a device pixel for every pixel drawn, or the largest there
 * is; falls back to the idle pose and finally to null when this color has no pictures. */
export function robotPicture(
  color: RobotColor,
  pose: RobotPose,
  size: number,
  density: number,
  images: readonly RobotImage[] = ROBOT_IMAGES,
): string | null {
  const own = images.filter((image) => image.color === color);
  if (!own.length) return null;
  const posed = own.filter((image) => image.pose === pose);
  const pool = posed.length ? posed : own.filter((image) => image.pose === "idle");
  if (!pool.length) return null;
  const wanted = size * Math.max(1, density);
  return (pool.find((image) => image.px >= wanted) ?? pool.at(-1)!).url;
}

/** Maps the mascot's drawn states onto the rig's four poses. */
export function robotPoseForState(state: string): RobotPose {
  switch (state) {
    case "working":
    case "thinking":
    case "searching":
      return "working";
    case "listening":
    case "waking":
      return "waiting";
    case "happy":
    case "celebrate":
    case "proud":
      return "replied";
    default:
      return "idle";
  }
}
