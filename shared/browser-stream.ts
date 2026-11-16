// Adapted from pingdotgg/t3code@00cdceb1, MIT License.
// Copyright (c) 2026 T3 Tools Inc. Full text: third_party/t3-code/LICENSE.


export type PreviewViewportSetting =
  | { readonly mode: "fill" }
  | { readonly mode: "preset"; readonly preset: "desktop" | "tablet" | "phone"; readonly landscape?: boolean };


export type PreviewStreamMouseButton = "none" | "left" | "middle" | "right";

export interface PreviewStreamControl {
  readonly canOperate: boolean;
  readonly controller: "agent" | "you" | "another-viewer" | "unclaimed";
  readonly generation: number;
  readonly dialog: null | {
    readonly type: string;
    readonly message: string;
    readonly defaultValue: string;
  };
  /** The bot's work outlasted the person's takeover and was cut off. */
  readonly stale?: boolean;
  /** The person watching holds the browser, from this view or another of theirs: they may hand it back from here. */
  readonly owned?: boolean;
  /** Opaque identity of this view's current takeover reservation. */
  readonly attempt?: string;
}


/** Client-to-server messages. Coordinates are page CSS px. */
export type PreviewStreamInput =
  | { readonly type: "takeControl"; readonly attempt?: string }
  | { readonly type: "releaseControl"; readonly attempt?: string }
  | { readonly type: "dialog"; readonly accept: boolean; readonly promptText?: string }
  | { readonly type: "viewport"; readonly setting: PreviewViewportSetting }
  | { readonly type: "zoom"; readonly factor: number }
  | {
      readonly type: "mouse";
      readonly action: "move" | "down" | "up";
      readonly x: number;
      readonly y: number;
      readonly button: PreviewStreamMouseButton;
      /** Pressed buttons: left 1, right 2, middle 4. */
      readonly buttons: number;
      readonly clickCount: number;
      readonly modifiers: number;
    }
  | {
      readonly type: "wheel";
      readonly x: number;
      readonly y: number;
      readonly deltaX: number;
      readonly deltaY: number;
      readonly modifiers: number;
    }
  | {
      readonly type: "key";
      readonly action: "down" | "up";
      readonly key: string;
      readonly code: string;
      /** Windows virtual key code (DOM `keyCode`); Enter, Backspace, and arrows need it. */
      readonly keyCode?: number;
      /** Only for printable keys without Ctrl or Meta. */
      readonly text?: string;
      readonly modifiers: number;
    }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "resize"; readonly width: number; readonly height: number }
  /** The viewer can show larger frames now: the screencast restarts at the new cap without reconnecting. */
  | { readonly type: "frameCap"; readonly maxWidth: number; readonly maxHeight: number }
  | { readonly type: "navigate"; readonly url: string }
  | { readonly type: "history"; readonly delta: -1 | 1 }
  | { readonly type: "reload"; readonly ignoreCache?: boolean }
  /** Asks whether the page point takes text. Touch viewers send it on touch start. */
  | { readonly type: "probe"; readonly x: number; readonly y: number }
  | { readonly type: "tabSelect"; readonly tabId: string }
  | { readonly type: "tabNew"; readonly url?: string }
  | { readonly type: "tabClose"; readonly tabId: string }
  | { readonly type: "selectChoose"; readonly id: string; readonly index: number }
  /** Answers the sign-in prompt `id` of tab `tabId`, as it was shown; without a username and password it cancels it. */
  | { readonly type: "authAnswer"; readonly tabId: string; readonly id: string; readonly username?: string; readonly password?: string }
  | { readonly type: "restart" }
  /** Starts the browser again after it closed unused (the server sent `asleep`); `awake` follows once it runs. */
  | { readonly type: "wake" };

