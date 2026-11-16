import { useMemo, type Dispatch, type MouseEvent } from "react";
import { visibleMessages, type Action, type AppState, type Bot, type InstanceInfo, type Message } from "@/state/store";
import type { BotRowDrag } from "@/components/SidebarBotDrag";
import type { BotDropPlace } from "./sidebar-bot-drop";
import type { SidebarDensity } from "./sidebar-preferences";
import { activeLocale } from "./i18n";
import { llmThreadTitlesEnabled } from "./feature-flags";

export function botListItemPointerIntent(
  type: string,
  insideRenameInput = false,
): "select" | "ignore" {
  return type === "click" && !insideRenameInput ? "select" : "ignore";
}
export interface MenuState {
  botId: string;
  x: number;
  y: number;
}

export function openBotContextMenu(onMenu: (menu: MenuState) => void, botId: string, event: MouseEvent) {
  event.preventDefault();
  onMenu({ botId, x: event.clientX, y: event.clientY });
}
export interface BotRowProps {
  bot: Bot;
  selected: boolean;
  deleting: boolean;
  mascotMotion: AppState["mascotMotion"];
  reveal: AppState["revealThread"];
  pendingQueued: AppState["pendingQueued"];
  instances: InstanceInfo[];
  liveCall: AppState["liveCall"];
  locale: string;
  generatedTitles: boolean;
  density: SidebarDensity;
  query: string;
  dispatch: Dispatch<Action>;
  onMenu: (menu: MenuState) => void;
  renameRequest?: number;
  botDrag?: BotRowDrag;
  botDrop?: BotDropPlace | null;
  botDragging?: boolean;
}

export function botRowProps(
  state: AppState,
  dispatch: Dispatch<Action>,
  bot: Bot,
  layout: Pick<BotRowProps, "density" | "query" | "onMenu" | "renameRequest" | "botDrag" | "botDrop" | "botDragging">,
): BotRowProps {
  const selected = state.activeView === "chat" && state.selectedId === bot.id;
  const reveal = state.revealThread;
  return {
    ...layout,
    bot,
    selected,
    deleting: state.deletingBots[bot.id] === true,
    mascotMotion: selected && state.mascotMotion?.botId === bot.id ? state.mascotMotion : null,
    reveal: reveal && (bot.threadId === reveal.threadId || bot.tasks?.some((task) => task.threadId === reveal.threadId)) ? reveal : null,
    pendingQueued: state.pendingQueued,
    instances: state.instances,
    liveCall: state.liveCall,
    locale: activeLocale(),
    generatedTitles: llmThreadTitlesEnabled(state.config),
    dispatch,
  };
}

export function useVisibleMessages(bot: Bot): Message[] {
  const { messages, activeLeafId } = bot;
  return useMemo(() => visibleMessages({ messages, activeLeafId }), [messages, activeLeafId]);
}
