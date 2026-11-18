import { z } from "zod";
import type { ComputerGuards } from "./guards.ts";

const off = () => z.boolean().optional();

/** The computer-use switches in config.json's `features`. Each is off unless set to true, by hand: none should default
 * on before a run on a real driver for the platform. They are spread into the config schema. */
export const computerFeatureShape = {
  /** Read this computer's window back after every action a bot takes on it, and tell the bot what it changed. It costs
   * driver reads per action (about 150 ms each on a small window, Windows driver 0.28.2), and has been run on a real driver once. */
  verifyComputerEffects: off(),
  /** Refuse index or point actions after a window changes until the bot reads it again. */
  guardComputerStale: off(),
  /** Stop repeated unchanged actions and cap actions in one computer session. */
  guardComputerLoops: off(),
  /** Compare typed text with a non-secret field read-back inside the computer bridge. */
  verifyComputerTyping: off(),
  /** Suggest a fresh element identity in stale target refusals. */
  anchorComputerTargets: off(),
  /** Verify scroll movement and try bounded scroll-area and page-key fallbacks. */
  verifyComputerScroll: off(),
  /** Wrap screen text as untrusted data and remove the values of secure or secret-named fields from window results. */
  wrapComputerScreenData: off(),
  /** Add the see-act-verify workflow to computer tool descriptions. */
  guideComputerUse: off(),
  /** Show the driver's cursor gliding to each target so the person can follow along and take control. */
  showComputerPointer: off(),
  /** Ask the person before a bot presses something on their computer that cannot be undone. */
  confirmComputerFinalActions: off(),
  /** Count what a computer session did and attach one plain line about it to the turn. */
  reportComputerEvidence: off(),
};

export type ComputerFeatureFlags = { [Name in keyof typeof computerFeatureShape]?: boolean };

/** The checks a computer session runs, from the person's config. */
export function computerGuardsFrom(features: ComputerFeatureFlags | undefined): ComputerGuards {
  return {
    stale: features?.guardComputerStale, loop: features?.guardComputerLoops, typing: features?.verifyComputerTyping,
    anchor: features?.anchorComputerTargets, scroll: features?.verifyComputerScroll, untrusted: features?.wrapComputerScreenData,
    guidance: features?.guideComputerUse, pointer: features?.showComputerPointer, evidence: features?.reportComputerEvidence,
    risk: features?.confirmComputerFinalActions,
  };
}

export const verifyComputerEffectsEnabled = (features: ComputerFeatureFlags | undefined): boolean => features?.verifyComputerEffects === true;
