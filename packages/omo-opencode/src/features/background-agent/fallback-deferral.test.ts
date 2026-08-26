import { describe, test, expect } from "bun:test"
import { createFallbackDeferralTracker, type FallbackDeferralScheduleFn } from "./fallback-deferral"

interface ManualScheduler {
  scheduleFn: FallbackDeferralScheduleFn
  registeredCount(): number
  fireAll(): void
  allCancelled(): boolean
}

function createManualScheduler(): ManualScheduler {
  const entries: Array<{ onFire: () => void; isCancelled: boolean }> = []
  const scheduleFn: FallbackDeferralScheduleFn = (_delayMs, onFire) => {
    const entry = { onFire, isCancelled: false }
    entries.push(entry)
    return () => {
      entry.isCancelled = true
    }
  }
  return {
    scheduleFn,
    registeredCount() {
      return entries.length
    },
    fireAll() {
      for (const entry of [...entries]) {
        if (!entry.isCancelled) {
          entry.onFire()
        }
      }
    },
    allCancelled() {
      return entries.every((entry) => entry.isCancelled)
    },
  }
}

describe("createFallbackDeferralTracker", () => {
  describe("#given a manual scheduler", () => {
    test("#when schedule is called #then it registers a one-shot timer and reports pending", () => {
      //#given
      const scheduler = createManualScheduler()
      const tracker = createFallbackDeferralTracker({ scheduleFn: scheduler.scheduleFn })
      let fired = 0

      //#when
      const scheduled = tracker.schedule("task-1", 1000, () => {
        fired += 1
      })

      //#then
      expect(scheduled).toBe(true)
      expect(tracker.isPending("task-1")).toBe(true)
      expect(fired).toBe(0)
      expect(scheduler.registeredCount()).toBe(1)
    })

    test("#when the timer fires #then the callback runs exactly once and pending clears before the callback", () => {
      //#given
      const scheduler = createManualScheduler()
      const tracker = createFallbackDeferralTracker({ scheduleFn: scheduler.scheduleFn })
      const pendingDuringFire: boolean[] = []
      tracker.schedule("task-1", 500, () => {
        pendingDuringFire.push(tracker.isPending("task-1"))
      })

      //#when
      scheduler.fireAll()

      //#then
      expect(pendingDuringFire).toEqual([false])
      expect(tracker.isPending("task-1")).toBe(false)
    })

    test("#when a second trigger arrives while pending #then schedule is rejected and only one timer exists", () => {
      //#given
      const scheduler = createManualScheduler()
      const tracker = createFallbackDeferralTracker({ scheduleFn: scheduler.scheduleFn })
      let fired = 0
      tracker.schedule("task-1", 500, () => {
        fired += 1
      })

      //#when
      const second = tracker.schedule("task-1", 500, () => {
        fired += 1
      })

      //#then
      expect(second).toBe(false)
      expect(scheduler.registeredCount()).toBe(1)

      scheduler.fireAll()
      expect(fired).toBe(1)
    })

    test("#when cancel is called before firing #then the underlying timer is cancelled and never fires", () => {
      //#given
      const scheduler = createManualScheduler()
      const tracker = createFallbackDeferralTracker({ scheduleFn: scheduler.scheduleFn })
      let fired = 0
      tracker.schedule("task-1", 500, () => {
        fired += 1
      })

      //#when
      tracker.cancel("task-1")

      //#then
      expect(tracker.isPending("task-1")).toBe(false)
      expect(scheduler.allCancelled()).toBe(true)

      scheduler.fireAll()
      expect(fired).toBe(0)
    })

    test("#when cancelAll is called #then every pending timer is cancelled", () => {
      //#given
      const scheduler = createManualScheduler()
      const tracker = createFallbackDeferralTracker({ scheduleFn: scheduler.scheduleFn })
      let fired = 0
      tracker.schedule("task-a", 100, () => {
        fired += 1
      })
      tracker.schedule("task-b", 200, () => {
        fired += 1
      })

      //#when
      tracker.cancelAll()

      //#then
      expect(tracker.pendingTaskIds()).toEqual([])
      scheduler.fireAll()
      expect(fired).toBe(0)
    })

    test("#when independent tasks are scheduled #then each fires separately by task id", () => {
      //#given
      const scheduler = createManualScheduler()
      const tracker = createFallbackDeferralTracker({ scheduleFn: scheduler.scheduleFn })
      const fired: string[] = []
      tracker.schedule("task-a", 100, () => {
        fired.push("a")
      })
      tracker.schedule("task-b", 200, () => {
        fired.push("b")
      })

      //#when
      scheduler.fireAll()

      //#then
      expect(fired.sort()).toEqual(["a", "b"])
      expect(tracker.pendingTaskIds().sort()).toEqual([])
    })

    test("#when no deps are given #then the default setTimeout-backed scheduler is used without firing early", () => {
      //#given
      const tracker = createFallbackDeferralTracker()
      let fired = 0

      //#when
      const scheduled = tracker.schedule("task-real", 5, () => {
        fired += 1
      })

      //#then
      expect(scheduled).toBe(true)
      expect(fired).toBe(0)
      tracker.cancel("task-real")
      expect(tracker.isPending("task-real")).toBe(false)
    })
  })
})
