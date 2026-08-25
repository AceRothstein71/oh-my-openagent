import { describe, expect, test } from "bun:test"

import bundledModelCapabilitiesSnapshotJson from "../../../packages/omo-opencode/src/generated/model-capabilities.generated.json"
import { getBundledModelCapabilitiesSnapshot } from "./model-capabilities"
import { CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

function acceptsImageInput(
  snapshotModels: Record<string, { modalities?: { input?: string[] } }>,
  modelID: string,
): boolean {
  const entry = snapshotModels[modelID.trim().toLowerCase()]
  return entry?.modalities?.input?.includes("image") ?? false
}

describe("vision category fallback invariant", () => {
  test("#given the visual-engineering chain #when every rung model is checked against the bundled capabilities snapshot #then no rung pairs a text-only model (issue #6268)", () => {
    // given
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson)
    const chain = CATEGORY_MODEL_REQUIREMENTS["visual-engineering"].fallbackChain

    // when
    const textOnlyRungs = chain.filter((entry) => !acceptsImageInput(bundledSnapshot.models, entry.model))

    // then
    expect(textOnlyRungs).toEqual([])
  })

  test("#given an opencode-go user walking the visual-engineering chain #when the opencode-go rungs are collected #then at least one exists and every one is vision-capable", () => {
    // given
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson)
    const chain = CATEGORY_MODEL_REQUIREMENTS["visual-engineering"].fallbackChain

    // when
    const openCodeGoRungs = chain.filter((entry) => entry.providers.includes("opencode-go"))

    // then
    expect(openCodeGoRungs.length).toBeGreaterThanOrEqual(1)
    for (const rung of openCodeGoRungs) {
      expect(acceptsImageInput(bundledSnapshot.models, rung.model)).toBe(true)
    }
  })
})
