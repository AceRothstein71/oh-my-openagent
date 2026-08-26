export type FallbackDeferralScheduleFn = (delayMs: number, onFire: () => void) => () => void

export interface FallbackDeferralTracker {
  schedule(taskId: string, delayMs: number, onFire: () => void): boolean
  cancel(taskId: string): void
  cancelAll(): void
  isPending(taskId: string): boolean
  pendingTaskIds(): string[]
}

interface FallbackDeferralTrackerDeps {
  scheduleFn?: FallbackDeferralScheduleFn
}

const defaultScheduleFn: FallbackDeferralScheduleFn = (delayMs, onFire) => {
  const timer = setTimeout(onFire, delayMs)
  return () => {
    clearTimeout(timer)
  }
}

export function createFallbackDeferralTracker(deps: FallbackDeferralTrackerDeps = {}): FallbackDeferralTracker {
  const scheduleFn = deps.scheduleFn ?? defaultScheduleFn
  const pendingByTaskId = new Map<string, () => void>()

  return {
    schedule(taskId, delayMs, onFire) {
      if (pendingByTaskId.has(taskId)) {
        return false
      }
      const cancelTimer = scheduleFn(delayMs, () => {
        pendingByTaskId.delete(taskId)
        onFire()
      })
      pendingByTaskId.set(taskId, cancelTimer)
      return true
    },
    cancel(taskId) {
      const cancelTimer = pendingByTaskId.get(taskId)
      if (!cancelTimer) {
        return
      }
      pendingByTaskId.delete(taskId)
      cancelTimer()
    },
    cancelAll() {
      for (const taskId of [...pendingByTaskId.keys()]) {
        this.cancel(taskId)
      }
    },
    isPending(taskId) {
      return pendingByTaskId.has(taskId)
    },
    pendingTaskIds() {
      return [...pendingByTaskId.keys()]
    },
  }
}
