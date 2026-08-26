import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.ts";
import { captureAndClearUlwLoopSessionEnv, restoreUlwLoopSessionEnv } from "./session-env-isolation.js";

let testDir: string;
let out: string[];
let err: string[];
let sessionEnvSnapshot: ReturnType<typeof captureAndClearUlwLoopSessionEnv>;

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ug-cli-json-err-"));
	out = [];
	err = [];
	sessionEnvSnapshot = captureAndClearUlwLoopSessionEnv();
	vi.spyOn(process, "cwd").mockReturnValue(testDir);
	vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
		out.push(chunk.toString());
		return true;
	});
	vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
		err.push(chunk.toString());
		return true;
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	restoreUlwLoopSessionEnv(sessionEnvSnapshot);
	await rm(testDir, { recursive: true, force: true });
});

function stdoutJson(): Record<string, unknown> {
	return JSON.parse(out.join(""));
}

describe("ulwLoopCommand --json error contract", () => {
	it("#given no plan #when status --json #then emits JSON error on stdout, nothing on stderr, exit 1", async () => {
		const code = await ulwLoopCommand(["status", "--json"]);

		expect(code).toBe(1);
		expect(err.join("")).toBe("");
		expect(stdoutJson()).toMatchObject({
			ok: false,
			error: { code: "ULW_LOOP_PLAN_MISSING", message: expect.stringContaining("No ulw-loop plan") },
		});
	});

	it("#given no plan #when complete-goals --json #then emits JSON error on stdout, exit 1", async () => {
		const code = await ulwLoopCommand(["complete-goals", "--json"]);

		expect(code).toBe(1);
		expect(err.join("")).toBe("");
		expect(stdoutJson()).toMatchObject({ ok: false, error: { code: "ULW_LOOP_PLAN_MISSING" } });
	});

	it("#given an unknown subcommand #when --json #then emits a JSON error (not help text), exit 1", async () => {
		const code = await ulwLoopCommand(["wat", "--json"]);

		expect(code).toBe(1);
		expect(out.join("")).not.toContain("Usage:");
		expect(stdoutJson()).toMatchObject({ ok: false, error: { code: expect.any(String) } });
	});

	it("#given a malformed required flag #when --json #then surfaces the UlwLoopError code with details on stdout", async () => {
		const code = await ulwLoopCommand(["criteria", "--json"]);

		expect(code).toBe(1);
		expect(err.join("")).toBe("");
		expect(stdoutJson()).toMatchObject({
			ok: false,
			error: { code: "ULW_LOOP_ARGUMENT_MISSING", details: { flag: "--goal-id" } },
		});
	});
});
