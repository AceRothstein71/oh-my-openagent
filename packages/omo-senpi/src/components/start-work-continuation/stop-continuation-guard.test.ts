import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  createStopContinuationGuard,
  getOrCreateStopContinuationGuard,
  peekStopContinuationGuard,
} from "./stop-continuation-guard"

describe("stop-continuation-guard (standalone)", () => {
  it("#given a fresh guard #when queried for an unknown session #then reports not stopped", () => {
    const guard = createStopContinuationGuard()
    expect(guard.isStopped("qa-s1")).toBe(false)
  })

  it("#given stop is called #when isStopped is queried #then returns true", () => {
    const guard = createStopContinuationGuard()
    guard.stop("qa-s1")
    expect(guard.isStopped("qa-s1")).toBe(true)
  })

  it("#given clear is called after stop #when isStopped is queried #then returns false", () => {
    const guard = createStopContinuationGuard()
    guard.stop("qa-s1")
    guard.clear("qa-s1")
    expect(guard.isStopped("qa-s1")).toBe(false)
  })

  it("#given two sessions #when one is stopped #then the other stays not stopped", () => {
    const guard = createStopContinuationGuard()
    guard.stop("qa-s1")
    expect(guard.isStopped("qa-s1")).toBe(true)
    expect(guard.isStopped("qa-s2")).toBe(false)
  })
})

describe("stop-continuation-guard (per-pi sharing)", () => {
  it("#given the same pi #when getOrCreateStopContinuationGuard is called twice #then returns the same guard", () => {
    // This is the ulw-loop <-> start-work-continuation sharing contract: both
    // components resolve the guard via the same pi and MUST observe one set of
    // stopped sessions.
    const pi = new FakeExtensionAPI()
    const first = getOrCreateStopContinuationGuard(pi)
    const second = getOrCreateStopContinuationGuard(pi)
    expect(second).toBe(first)
  })

  it("#given two independent pi instances #when each creates a guard #then they are independent", () => {
    const piA = new FakeExtensionAPI()
    const piB = new FakeExtensionAPI()
    const guardA = getOrCreateStopContinuationGuard(piA)
    const guardB = getOrCreateStopContinuationGuard(piB)
    guardA.stop("qa-s1")
    expect(guardB.isStopped("qa-s1")).toBe(false)
  })

  it("#given a pi with no guard installed #when peeked #then returns undefined", () => {
    const pi = new FakeExtensionAPI()
    expect(peekStopContinuationGuard(pi)).toBeUndefined()
    getOrCreateStopContinuationGuard(pi)
    expect(peekStopContinuationGuard(pi)).toBeDefined()
  })
})
