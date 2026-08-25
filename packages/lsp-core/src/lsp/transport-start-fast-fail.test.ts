import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { LspClientConnection } from "./connection.js";
import { resolveStartTimeoutMs, START_TIMEOUT_MS } from "./constants.js";
import { LspProcessExitedError } from "./errors.js";
import type { ResolvedServer } from "./types.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function tempRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	tempDirectories.push(root);
	return root;
}

function server(id: string, command: string[]): ResolvedServer {
	return { id, command, extensions: [], priority: 0 };
}

async function elapsedMs(run: () => Promise<void>): Promise<{ error: unknown; elapsed: number }> {
	const startedAt = Date.now();
	try {
		await run();
		return { error: undefined, elapsed: Date.now() - startedAt };
	} catch (error) {
		return { error, elapsed: Date.now() - startedAt };
	}
}

describe("LSP start fast-fail (#6486)", () => {
	it("#given a server command that fails asynchronously after spawn #when starting and initializing #then rejects with LspProcessExitedError within seconds instead of blocking for the init ceiling", async () => {
		// given
		const transport = new LspClientConnection(
			tempRoot("lsp-6486-async-exit-"),
			server("missing-binary-6486", ["omo-missing-lsp-binary-6486"]),
		);

		// when
		const { error, elapsed } = await elapsedMs(async () => {
			await transport.start();
			await transport.initialize();
		});

		// then
		expect(error).toBeInstanceOf(LspProcessExitedError);
		expect(elapsed).toBeLessThan(5_000);
	}, 10_000);

	it("#given a spawned server that consumes the initialize write and then exits without responding #when starting and initializing #then rejects with LspProcessExitedError within seconds instead of blocking for the init ceiling", async () => {
		// given
		const transport = new LspClientConnection(
			tempRoot("lsp-6486-late-exit-"),
			server("late-exit-6486", ["sh", "-c", "sleep 0.5"]),
		);

		// when
		const { error, elapsed } = await elapsedMs(async () => {
			await transport.start();
			await transport.initialize();
		});

		// then
		expect(error).toBeInstanceOf(LspProcessExitedError);
		expect(elapsed).toBeLessThan(5_000);
	}, 10_000);

	it("#given a responsive server #when starting and initializing within the start deadline #then initialize resolves and stop cleans up", async () => {
		// given
		const fixturePath = join(import.meta.dir, "fixtures", "initialize-echo-server.mjs");
		const transport = new LspClientConnection(tempRoot("lsp-6486-healthy-"), server("echo-6486", [process.execPath, fixturePath]), {
			startTimeoutMs: 5_000,
		});

		// when
		await transport.start();
		await transport.initialize();

		// then
		expect(transport.isAlive()).toBe(true);
		await transport.stop();
	}, 10_000);

	it("#given an alive server that never answers initialize #when starting and initializing #then rejects with a start timeout at the short deadline instead of the init ceiling", async () => {
		// given
		const root = tempRoot("lsp-6486-silent-");
		const transport = new LspClientConnection(root, server("silent-6486", ["sleep", "30"]), {
			startTimeoutMs: 200,
		});

		try {
			// when
			const { error, elapsed } = await elapsedMs(async () => {
				await transport.start();
				await transport.initialize();
			});

			// then
			expect(error).toBeInstanceOf(Error);
			expect((error as Error | undefined)?.name).toBe("LspStartTimeoutError");
			expect((error as Error | undefined)?.message).toContain("OMO_LSP_START_TIMEOUT_MS");
			expect(elapsed).toBeLessThan(5_000);
		} finally {
			const pid = transport.pid();
			if (pid !== undefined) {
				try {
					process.kill(-pid, "SIGKILL");
				} catch {
					// process group already gone
				}
			}
		}
	}, 10_000);
});

describe("resolveStartTimeoutMs", () => {
	it("#given OMO_LSP_START_TIMEOUT_MS values #when resolved #then positive integers win and missing or invalid values fall back to the default", () => {
		expect(resolveStartTimeoutMs({})).toBe(START_TIMEOUT_MS);
		expect(resolveStartTimeoutMs({ OMO_LSP_START_TIMEOUT_MS: "2500" })).toBe(2500);
		expect(resolveStartTimeoutMs({ OMO_LSP_START_TIMEOUT_MS: "" })).toBe(START_TIMEOUT_MS);
		expect(resolveStartTimeoutMs({ OMO_LSP_START_TIMEOUT_MS: "  " })).toBe(START_TIMEOUT_MS);
		expect(resolveStartTimeoutMs({ OMO_LSP_START_TIMEOUT_MS: "soon" })).toBe(START_TIMEOUT_MS);
		expect(resolveStartTimeoutMs({ OMO_LSP_START_TIMEOUT_MS: "-5" })).toBe(START_TIMEOUT_MS);
		expect(resolveStartTimeoutMs({ OMO_LSP_START_TIMEOUT_MS: "0" })).toBe(START_TIMEOUT_MS);
	});
});
