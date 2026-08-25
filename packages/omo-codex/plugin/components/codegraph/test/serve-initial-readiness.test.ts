import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { resolveSessionStartStatePaths } from "../src/session-start-paths.js";
import { waitForInitialCodegraphGraph } from "../src/serve-readiness.ts";

function tempDir(): string {
	return mkdtempSync(join(import.meta.dir, ".tmp-readiness-"));
}

function writeLiveLock(homeDir: string, projectRoot: string): void {
	const lockPath = resolveSessionStartStatePaths(homeDir, projectRoot).lockPath;
	mkdirSync(dirname(lockPath), { recursive: true });
	writeFileSync(lockPath, `${JSON.stringify({ projectRoot, token: "token" })}\n`);
}

function ageLock(homeDir: string, projectRoot: string, ageMs: number): void {
	const lockPath = resolveSessionStartStatePaths(homeDir, projectRoot).lockPath;
	const past = new Date(Date.now() - ageMs);
	utimesSync(lockPath, past, past);
}

describe("waitForInitialCodegraphGraph", () => {
	it("#given an initialized graph #when waiting #then it reports ready immediately", async () => {
		const homeDir = tempDir();
		const projectRoot = tempDir();
		try {
			let probes = 0;
			const outcome = await waitForInitialCodegraphGraph(projectRoot, {
				homeDir,
				probe: () => {
					probes += 1;
					return { kind: "initialized" };
				},
			});
			expect(outcome).toBe("ready");
			expect(probes).toBe(1);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});

	it("#given no bootstrap lock #when the graph is uninitialized #then it reports idle without waiting", async () => {
		const homeDir = tempDir();
		const projectRoot = tempDir();
		try {
			let probes = 0;
			const startedAt = Date.now();
			const outcome = await waitForInitialCodegraphGraph(projectRoot, {
				homeDir,
				pollIntervalMs: 5,
				timeoutMs: 5_000,
				probe: () => {
					probes += 1;
					return { kind: "uninitialized" };
				},
			});
			expect(outcome).toBe("idle");
			expect(probes).toBe(1);
			expect(Date.now() - startedAt).toBeLessThan(1_000);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});

	it("#given a live bootstrap lock #when the database appears during the wait #then it reports ready", async () => {
		const homeDir = tempDir();
		const projectRoot = tempDir();
		try {
			writeLiveLock(homeDir, projectRoot);
			let probes = 0;
			const outcome = await waitForInitialCodegraphGraph(projectRoot, {
				homeDir,
				pollIntervalMs: 5,
				timeoutMs: 5_000,
				probe: () => {
					probes += 1;
					return probes <= 2 ? { kind: "uninitialized" } : { kind: "initialized" };
				},
			});
			expect(outcome).toBe("ready");
			expect(probes).toBe(3);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});

	it("#given a stale bootstrap lock #when the graph is uninitialized #then it reports idle", async () => {
		const homeDir = tempDir();
		const projectRoot = tempDir();
		try {
			writeLiveLock(homeDir, projectRoot);
			ageLock(homeDir, projectRoot, 11 * 60 * 1_000);
			const outcome = await waitForInitialCodegraphGraph(projectRoot, {
				homeDir,
				pollIntervalMs: 5,
				timeoutMs: 5_000,
				probe: () => ({ kind: "uninitialized" }),
			});
			expect(outcome).toBe("idle");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});

	it("#given a live lock and a graph that never becomes ready #when the timeout elapses #then it reports timeout", async () => {
		const homeDir = tempDir();
		const projectRoot = tempDir();
		try {
			writeLiveLock(homeDir, projectRoot);
			const startedAt = Date.now();
			const outcome = await waitForInitialCodegraphGraph(projectRoot, {
				homeDir,
				pollIntervalMs: 5,
				timeoutMs: 40,
				probe: () => ({ kind: "uninitialized" }),
			});
			expect(outcome).toBe("bootstrap-in-flight-timeout");
			expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});
});
