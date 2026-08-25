# Plan - issue #6808 Kimi-only quick route quota-403 recovery

## Root cause

Memory Reflection defaults to the `quick` category whose shipped builtin default is
Kimi-only (`packages/senpi-task/src/category/openai-categories.ts:128-133`,
`config: { model: "kimi-coding/kimi-for-coding-highspeed" }`). When the reflection
child dies with Kimi's billing-cycle response:

```
403 permission_error
You've reached your usage limit for this billing cycle
```

`classifyRetryableModelMiss` (`packages/omo-senpi/src/components/memory/worker/model-miss.ts:20-40`)
returns `undefined` (terminal) because:

1. `providerFailureDetail` (:43-49) keeps only the FIRST non-empty stderr line
   (`"403 permission_error"`), discarding the billing-cycle reason line.
2. The shared classifier `isRetryableModelError`
   (`packages/model-core/src/model-error-classifier.ts:181-186`) retries only
   429/503/529 status codes; `"403 permission_error"` matches no retryable message
   pattern and no STOP pattern either, so it falls through to terminal.

Result: the candidate chain in `runMemoryModelAttempts`
(`memory-model-attempts.ts:37-52`) never advances to the next candidate; the run is
recorded dead. Users without usable Kimi access get silently failing reflections.

## Fix (consumer-layer, mirrors PR #7182 session-stable fallback convention)

Classify the reproduced Kimi billing-cycle quota-403 shape as retryable
`provider_unavailable` at the memory-worker seam, so the existing chain machinery
advances to the next candidate. Shared classifier untouched (its billing/quota STOP
table keeps generic org-quota terminal for every other consumer).

### Files

1. `packages/omo-senpi/src/components/memory/worker/model-miss.ts`
   - Add `KIMI_PERMISSION_ERROR_CONTEXT_PATTERN` (403 adjacent to permission_error,
     either order) + `KIMI_BILLING_CYCLE_LIMIT_PATTERN` ("you've reached your usage
     limit for this billing cycle", straight/curly apostrophe, case-insensitive).
   - In `classifyRetryableModelMiss`, after the auth_missing check: if both patterns
     match the full output, return `{ kind: "provider_unavailable", detail }` with a
     bounded multi-line detail (non-empty stderr/stdout lines joined " | ", capped at
     PROVIDER_DETAIL_MAX_CHARS). Other classifications keep byte-identical details.
2. `packages/omo-senpi/src/components/memory/worker/model-miss.test.ts`
   - Regression: given exact issue payload stderr, when classified, then retryable
     provider_unavailable with both lines preserved.
3. `packages/omo-senpi/src/components/memory/worker/memory-model-attempts.test.ts`
   - Regression: given primary dies with the payload and a fallback exists, when the
     chain runs, then it attempts both candidates and returns the fallback result.

### Deliberately unchanged / terminal pins kept green

- Generic org-quota exhaustion ("Error: quota exceeded for this organization")
  stays terminal (existing tests model-miss.test.ts:60, memory-model-attempts.test.ts:80).
- Bare 403 without the billing-cycle usage-limit text stays terminal (shared classifier).
- Chain exhaustion still throws typed MemoryModelExhaustedError with fingerprint detail.
- No changes to model-core shared table, senpi-task category defaults, fixtures, or
  generated plugin artifacts.

## Verification

1. RED first: scoped new tests fail before implementation.
2. GREEN after: `bun test packages/omo-senpi/src/components/memory/worker`.
3. `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`.

## Evidence

This directory records plan, red/green outputs, and the WHAT/OBSERVED/WHY/OMITTED
summary. No secrets; raw env dumps omitted.
