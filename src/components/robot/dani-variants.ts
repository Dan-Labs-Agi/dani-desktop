/**
 * The Dani character variants: the original Manzanilla two-legged rig, refined
 * for Dani Desktop. Seven looks told apart by shell color, hairstyle and a
 * decorative accessory - nobody carries anything, and no accessory implies a
 * job. Dani (purple, crown) is the main agent.
 *
 * Built with the same primitives as robot-model.ts so body, face, proportions,
 * posing and materials stay identical to the original character.
 */
import * as THREE from "three";

import {
  ellipsoid,
  group,
  line,
  makeBody,
  makeFace,
  makeLeaf,
  material,
  mesh,
  poseRobotModel,
  roundBox,
  surfaceDepth,
  type RobotRig,
} from "./robot-model";

export const DANI_VARIANTS = [
  { id: "dani", label: "Dani", color: "#9561ED" },
  { id: "sprout", label: "Sprout", color: "#17B4BD" },
  { id: "tuft", label: "Tuft", color: "#3299F4" },
  { id: "sweep", label: "Sweep", color: "#20BA78" },
  { id: "cap", label: "Cap", color: "#FF934F" },
  { id: "shades", label: "Shades", color: "#ED6383" },
  { id: "bow", label: "Bow", color: "#E65CAA" },
] as const;

export type DaniVariantId = (typeof DANI_VARIANTS)[number]["id"];

function addCrown(head: THREE.Group, shell: THREE.Material): void {
  const gold = material("#F7BD45", 0.3);
  const crown = group(head, "crown", [0, 0.8, 0.06]);
  const shape = new THREE.Shape();
  shape.moveTo(-0.32, 0);
  shape.lineTo(-0.38, 0.34);
  shape.lineTo(-0.17, 0.22);
  shape.lineTo(0, 0.43);
  shape.lineTo(0.17, 0.22);
  shape.lineTo(0.38, 0.34);
  shape.lineTo(0.32, 0);
  shape.closePath();
  mesh(
    crown,
    "crown-gold",
    new THREE.ExtrudeGeometry(shape, {
      depth: 0.16,
      bevelEnabled: true,
      bevelSize: 0.025,
      bevelThickness: 0.022,
      bevelSegments: 3,
    }),
    gold,
    [0, 0, 0],
  );
  ellipsoid(crown, "crown-jewel", [0.042, 0.052, 0.022], shell, [0, 0.105, 0.188]);
}

function addSproutHair(sprout: THREE.Group): void {
  const leafGreen = material("#00B871", 0.3);
  line(
    sprout,
    "leaf-stem",
    [
      [0, 0, 0],
      [0.015, 0.14, 0.005],
      [0.045, 0.24, 0],
    ],
    leafGreen,
    0.025,
  );
  makeLeaf(sprout, "leaf-tall", leafGreen, [0, 0.08, 0], -0.23, 0.94);
  makeLeaf(sprout, "leaf-small", leafGreen, [0.005, 0.06, 0.04], -1.06, 0.77);
}

/** Three soft spikes standing off the crown line, like a short tuft. */
function addTuftHair(sprout: THREE.Group, hair: THREE.Material): void {
  for (const [i, lean] of [-0.55, 0, 0.55].entries()) {
    const spike = mesh(
      sprout,
      `tuft-spike-${i}`,
      new THREE.ConeGeometry(0.09 - Math.abs(lean) * 0.025, 0.42 - Math.abs(lean) * 0.12, 14),
      hair,
      [lean * 0.3, 0.16 - Math.abs(lean) * 0.05, 0],
    );
    spike.rotation.z = -lean * 0.75;
  }
}

/** A side-swept fringe lying over the forehead, with a small flick at the side. */
function addSweepHair(sprout: THREE.Group, hair: THREE.Material): void {
  const fringe = ellipsoid(sprout, "sweep-fringe", [0.58, 0.14, 0.4], hair, [-0.08, -0.04, 0.14]);
  fringe.rotation.set(0.28, 0, 0.16);
  const flick = ellipsoid(sprout, "sweep-flick", [0.18, 0.08, 0.11], hair, [0.4, -0.1, 0.12]);
  flick.rotation.z = -0.6;
}

/** A backwards ball cap; pure decoration. */
function addCap(sprout: THREE.Group, head: THREE.Group, shell: THREE.Material): void {
  const cap = group(head, "cap", [0, 0.55, -0.08]);
  const dome = ellipsoid(cap, "cap-dome", [0.78, 0.4, 0.72], shell, [0, 0.16, 0]);
  dome.rotation.x = 0.12;
  // Backwards snapback: the brim juts out back-right, peeking past the silhouette.
  const brim = roundBox(cap, "cap-brim", [0.52, 0.07, 0.5], 0.03, shell, [0.42, 0.12, -0.62]);
  brim.rotation.y = 0.85;
  brim.rotation.x = -0.12;
  ellipsoid(cap, "cap-button", [0.08, 0.05, 0.08], material("#24272E", 0.39), [0, 0.56, 0]);
}

/** Glossy shades resting on the face; pure decoration. */
function addShades(head: THREE.Group): void {
  const frame = material("#1E2229", 0.22);
  const shades = group(head, "shades", [0, 0.12, 0]);
  const depth = surfaceDepth(0.31, 0.12) + 0.075;
  roundBox(shades, "shades-left", [0.4, 0.24, 0.06], 0.05, frame, [-0.31, 0, depth]);
  roundBox(shades, "shades-right", [0.4, 0.24, 0.06], 0.05, frame, [0.31, 0, depth]);
  roundBox(shades, "shades-bridge", [0.24, 0.05, 0.05], 0.02, frame, [0, 0.04, depth]);
  line(
    shades,
    "shades-arm-left",
    [
      [-0.51, 0.03, depth],
      [-0.75, 0.05, 0.1],
    ],
    frame,
    0.035,
  );
  line(
    shades,
    "shades-arm-right",
    [
      [0.51, 0.03, depth],
      [0.75, 0.05, 0.1],
    ],
    frame,
    0.035,
  );
}

/** A ribbon bow clipped to one side; pure decoration. */
function addBow(sprout: THREE.Group, ribbon: THREE.Material): void {
  const left = mesh(sprout, "bow-left", new THREE.ConeGeometry(0.24, 0.42, 14), ribbon, [-0.2, 0.08, 0]);
  left.rotation.z = 1.35;
  const right = mesh(sprout, "bow-right", new THREE.ConeGeometry(0.24, 0.42, 14), ribbon, [0.2, 0.08, 0]);
  right.rotation.z = -1.35;
  ellipsoid(sprout, "bow-knot", [0.11, 0.11, 0.09], ribbon, [0, 0.08, 0.02]);
}

export function createDaniVariant(variantId: DaniVariantId = "dani"): THREE.Group {
  const variant = DANI_VARIANTS.find((item) => item.id === variantId) ?? DANI_VARIANTS[0];
  const root = new THREE.Group();
  root.name = `dani-${variant.id}`;
  root.userData.variant = variant.id;
  root.userData.artwork = "Original procedural Manzanilla robot, Dani variant";

  const white = material("#FAFAF7", 0.33);
  const ink = material("#24272E", 0.39);
  const shell = material(variant.color, 0.3);
  const sole = material(new THREE.Color(variant.color).multiplyScalar(0.66), 0.45);

  const body = group(root, "body", [0, 0, 0]);
  const head = group(body, "head", [0, 1.49, 0]);
  makeBody(head, "outer-shell", shell, shell);
  makeFace(head, white);
  const eyeDepth = surfaceDepth(0.31, 0.065) + 0.031;
  const leftEye = mesh(head, "eye-left", new THREE.CapsuleGeometry(0.085, 0.19, 6, 16), ink, [-0.31, 0.065, eyeDepth]);
  const rightEye = mesh(head, "eye-right", new THREE.CapsuleGeometry(0.085, 0.19, 6, 16), ink, [0.31, 0.065, eyeDepth]);
  leftEye.scale.z = rightEye.scale.z = 0.48;
  leftEye.rotation.z = rightEye.rotation.z = 0.075;
  const leftSmile = mesh(head, "eye-cheer-left", new THREE.TorusGeometry(0.1, 0.033, 9, 22, Math.PI), ink, [
    -0.31, 0.025, eyeDepth + 0.015,
  ]);
  const rightSmile = mesh(head, "eye-cheer-right", new THREE.TorusGeometry(0.1, 0.033, 9, 22, Math.PI), ink, [
    0.31, 0.025, eyeDepth + 0.015,
  ]);

  const leftArm = group(body, "arm-left", [-0.84, 1.0, 0.06]);
  const rightArm = group(body, "arm-right", [0.84, 1.0, 0.06]);
  for (const [arm, side] of [
    [leftArm, -1],
    [rightArm, 1],
  ] as const) {
    ellipsoid(arm, "shoulder-joint", [0.11, 0.13, 0.14], ink, [side * 0.018, -0.06, 0]);
    const forearm = mesh(arm, "hand", new THREE.CapsuleGeometry(0.155, 0.2, 6, 18), white, [side * 0.06, -0.2, 0.065]);
    forearm.scale.z = 0.82;
  }
  const leftFoot = group(root, "foot-left", [-0.37, 0.205, 0.09]);
  const rightFoot = group(root, "foot-right", [0.37, 0.205, 0.09]);
  for (const foot of [leftFoot, rightFoot]) {
    roundBox(foot, "ankle-joint", [0.29, 0.11, 0.34], 0.045, ink, [0, 0.14, -0.015]);
    ellipsoid(foot, "foot", [0.205, 0.145, 0.265], white, [0, 0, 0]);
    roundBox(foot, "sole", [0.33, 0.066, 0.44], 0.03, sole, [0, -0.122, -0.005]);
  }

  // Hair lives on the sprout group so posing sways it exactly like the original leaf.
  const sprout = group(head, "sprout", [0.42, 0.7, 0.035]);
  const hair = material(new THREE.Color(variant.color).multiplyScalar(0.5), 0.42);
  if (variant.id === "dani") {
    addCrown(head, shell);
  } else if (variant.id === "sprout") {
    addSproutHair(sprout);
    ellipsoid(head, "helmet-cap", [0.34, 0.17, 0.3], shell, [-0.22, 0.71, -0.08]);
  } else if (variant.id === "tuft") {
    sprout.position.set(0, 0.82, 0.05);
    addTuftHair(sprout, hair);
  } else if (variant.id === "sweep") {
    sprout.position.set(0, 0.72, 0.05);
    addSweepHair(sprout, hair);
  } else if (variant.id === "cap") {
    addCap(sprout, head, shell);
  } else if (variant.id === "shades") {
    addShades(head);
    ellipsoid(head, "helmet-cap", [0.34, 0.17, 0.3], shell, [-0.22, 0.71, -0.08]);
  } else if (variant.id === "bow") {
    sprout.position.set(0.42, 0.72, 0.06);
    addBow(sprout, material("#F7BD45", 0.3));
  }

  const rig: RobotRig = {
    body,
    head,
    sprout,
    leftArm,
    rightArm,
    leftFoot,
    rightFoot,
    leftEye,
    rightEye,
    leftSmile,
    rightSmile,
  };
  root.userData.rig = rig;
  poseRobotModel(root, { motion: "idle", time: 0 });
  return root;
}

/** Chief of Staff is always Dani; other bots take the variant nearest their color. */
export function daniVariantForBot(name: string | undefined, color: string): DaniVariantId {
  if (!name || /\b(chief|chief of staff|cos|coordinator|director|dani)\b/i.test(name)) return "dani";
  switch (color) {
    case "purple":
      return "dani";
    case "cyan":
    case "teal":
      return "sprout";
    case "blue":
      return "tuft";
    case "green":
      return "sweep";
    case "orange":
    case "yellow":
      return "cap";
    case "red":
    case "coral":
      return "shades";
    case "pink":
      return "bow";
    default:
      return "sprout";
  }
}
