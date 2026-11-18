import type { Coordinator } from "../coordinator.ts";
import type { TurnStop } from "../turn-outcome.ts";

/** A known account prerequisite has no accepted action with an uncertain result. */
export function knownProviderPrerequisite(stop: TurnStop | undefined): boolean {
  return Boolean(stop && !stop.cancelled && !stop.unknownEffect && !stop.flags?.permissionDenied
    && !stop.flags?.toolError && stop.flags?.recovery !== "blocked"
    && (stop.flags?.limit || stop.flags?.setup || stop.flags?.limitResetsAt));
}

/** A newly admitted turn replaces only the old request's isolated provider block.
 * The runtime itself refuses cards, denials and live children. This does not retry anything. */
export function retirePreviousProviderBlock(coordinator: Pick<Coordinator, "all" | "retireProviderBlock">,
  threadId: string, generations: ReadonlySet<string> | undefined, stop: TurnStop | undefined): boolean {
  if (!generations || !knownProviderPrerequisite(stop)) return false;
  const root = coordinator.all().filter(node => !node.parentId && !node.groupId && node.threadId === threadId && generations.has(node.id))
    .sort((a, b) => a.createdAt - b.createdAt).at(-1);
  return Boolean(root && coordinator.retireProviderBlock(root.id));
}
