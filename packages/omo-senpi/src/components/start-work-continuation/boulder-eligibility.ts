import {
  getPlanChecklist,
  getWorkForSession,
  resolveBoulderPlanPathForWork,
  type BoulderWorkState,
  type PlanChecklist,
} from "@oh-my-opencode/boulder-state"

export interface ContinuableWork {
  readonly work: BoulderWorkState
  readonly planPath: string
  readonly checklist: PlanChecklist
}

export function findContinuableBoulderWork(
  cwd: string,
  sessionId: string,
): ContinuableWork | null {
  const work = getWorkForSession(cwd, `senpi:${sessionId}`)
  if (!work) {
    return null
  }

  // Only `active` work is continuable. `paused` (and every other non-active status: `completed`,
  // `abandoned`) is intentionally excluded so an explicit pause suppresses the `agent_end`
  // continuation injection until the work is explicitly resumed. Ports the OpenCode
  // `stop-continuation-guard` semantics — see issue #6752.
  if (work.status !== "active") {
    return null
  }

  const planPath = resolveBoulderPlanPathForWork(cwd, work)
  const checklist = getPlanChecklist(planPath)
  if (checklist.total <= 0) {
    return null
  }

  return { work, planPath, checklist }
}

