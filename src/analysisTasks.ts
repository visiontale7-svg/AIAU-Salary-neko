import type { AnalysisTask } from "./domain";

export const TERMINAL_ANALYSIS_STATES = new Set<AnalysisTask["status"]>([
  "ready",
  "partial",
  "failed",
  "cancelled",
]);

export function activeTaskForConversation(
  tasks: Record<string, AnalysisTask>,
  conversationId?: string,
): AnalysisTask | undefined {
  if (!conversationId) return undefined;
  return Object.values(tasks)
    .filter((task) => task.conversationId === conversationId && !TERMINAL_ANALYSIS_STATES.has(task.status))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function activeAnalysisTasks(tasks: Record<string, AnalysisTask>): AnalysisTask[] {
  return Object.values(tasks)
    .filter((task) => !TERMINAL_ANALYSIS_STATES.has(task.status))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
