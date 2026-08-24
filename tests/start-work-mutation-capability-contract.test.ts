import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..")

// Issue #6709: start-work is unsatisfiable in repositories whose mutation policy permits only
// `apply_patch` for product files. In-process task workers never receive the `apply_patch`
// builtin (children load an empty extension set), while the skill forbids the orchestrator from
// editing product files, so an apply_patch-only repo leaves a worker lane with zero legal
// mutation paths and the plan stalls in BLOCKED. The fix is a dispatch-time capability probe
// plus a patch-broker flow, pinned by this machine-consumed contract embedded in the skill
// (same pattern as the ulw-plan review convergence contract, issue #6128): the JSON block is
// structured policy a machine can parse, so it is guarded here; the surrounding prose is not.
const skillPath = join(repoRoot, "packages", "shared-skills", "skills", "start-work", "SKILL.md")
const CONTRACT_NAME = "start-work-mutation-capability-contract"

function readContract(): Record<string, unknown> {
	const content = readFileSync(skillPath, "utf8")
	const fence = "```"
	const pattern = new RegExp(`<!-- ${CONTRACT_NAME} -->\\s*${fence}json\\s*([\\s\\S]*?)\\s*${fence}`)
	const match = content.match(pattern)
	if (!match?.[1]) throw new Error(`missing ${CONTRACT_NAME} json block in ${skillPath}`)
	return JSON.parse(match[1]) as Record<string, unknown>
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
}

describe("#given the start-work skill mutation capability contract", () => {
	describe("#when the contract block is parsed from SKILL.md", () => {
		const contract = readContract()

		test("#then it declares schema version 1", () => {
			expect(contract.schema_version).toBe(1)
		})

		test("#then the capability probe runs before the first dispatch and on a blocked worker", () => {
			const probe = contract.capability_probe as Record<string, unknown>
			const triggers = Array.isArray(probe?.when) ? (probe.when as string[]) : []
			expect(triggers).toContain("before_first_implementation_dispatch")
			expect(triggers).toContain("on_worker_blocked_without_legal_mutator")
			expect(probe?.method).toBe("worker_reports_its_actual_mutating_tool_names")
		})

		test("#then routing covers the direct edit/write flow and the patch-broker flow", () => {
			const routing = asRecordArray(contract.routing)
			const flows = routing.map((entry) => entry.flow)
			expect(flows).toContain("edit_write")
			expect(flows).toContain("patch_broker")
			for (const entry of routing) {
				expect(typeof entry.when).toBe("string")
				expect((entry.when as string).length).toBeGreaterThan(0)
			}
		})

		test("#then the patch-broker flow keeps authoring with the worker and applying with the orchestrator", () => {
			const broker = contract.patch_broker as Record<string, unknown>
			expect(broker?.author).toBe("worker")
			expect(broker?.applier).toBe("orchestrator")
			expect(broker?.apply_is_verbatim).toBe(true)

			const fields = Array.isArray(broker?.proposal_fields) ? (broker.proposal_fields as string[]) : []
			for (const required of ["paths", "base_commit", "test_patch", "production_patch"]) {
				expect(fields).toContain(required)
			}
		})

		test("#then the broker fails closed on scope, stale base, and apply failure", () => {
			const broker = contract.patch_broker as Record<string, unknown>
			expect(broker?.scope_check).toBe("reject_paths_outside_task_scope_before_apply")
			expect(broker?.on_apply_failure).toBe("return_to_same_worker_for_regeneration")
			expect(broker?.on_stale_base).toBe("never_repaired_by_orchestrator_regenerate_with_worker")
			expect(broker?.verification).toBe("same_worker_proves_test_patch_red_then_production_patch_green")
		})

		test("#then the contract forbids the orchestrator from authoring content or repairing proposals", () => {
			const forbidden = Array.isArray(contract.forbidden) ? (contract.forbidden as string[]) : []
			expect(forbidden).toContain("orchestrator_authors_or_edits_product_content")
			expect(forbidden).toContain("orchestrator_repairs_a_stale_proposal")
		})
	})
})
