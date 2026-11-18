import type { Coordinator } from "../coordinator.ts";

/** Read before the runtime settles a run's turn: the fold runs ahead of native settlement. */
export function runtimeWorkPending(coordinator: Pick<Coordinator, "outstandingFor" | "active" | "children">, threadId: string): boolean {
  if (coordinator.outstandingFor(threadId).length > 0) return true;
  return coordinator.active().some(root => !root.parentId && !root.groupId && root.threadId === threadId
    // RoutineManager owns retrying a cut native turn. Its restored root is not a delegation.
    && root.restart !== "rerun"
    && (root.status === "queued" || root.status === "waiting" || root.status === "resume"
      || ((root.status === "source" || root.status === "running")
        && coordinator.children(root.id).some(child => child.reply !== "none" && child.createdAt >= (root.startedAt ?? 0)))));
}
