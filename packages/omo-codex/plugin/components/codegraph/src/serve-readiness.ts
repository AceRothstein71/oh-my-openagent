import { statSync } from "node:fs";

import { DEFAULT_SESSION_START_LOCK_STALE_MS } from "./hook.js";
import { resolveSessionStartStatePaths } from "./session-start-paths.js";
import { probeCodegraphProject, type CodegraphProjectState } from "./session-start-project.js";

export type InitialGraphReadiness = "bootstrap-in-flight-timeout" | "idle" | "ready";

export const DEFAULT_INITIAL_GRAPH_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

export interface WaitForInitialCodegraphGraphOptions {
	readonly homeDir: string;
	readonly nowMs?: () => number;
	readonly pollIntervalMs?: number;
	readonly probe?: (projectRoot: string) => CodegraphProjectState;
	readonly timeoutMs?: number;
}

// Issue #5588 (LazyCodex cold start): Codex discovers MCP tools while the
// detached SessionStart worker is still bootstrapping, so tools/list can run
// against an uninitialized graph. When a bootstrap is actually in flight
// (fresh per-project lock), hold the serve bridge until the graph exists.
// No lock means nothing will produce the graph, so serving starts unchanged.
export async function waitForInitialCodegraphGraph(
	projectRoot: string,
	options: WaitForInitialCodegraphGraphOptions,
): Promise<InitialGraphReadiness> {
	const nowMs = options.nowMs ?? Date.now;
	const probe = options.probe ?? probeCodegraphProject;
	if (isGraphReady(probe(projectRoot))) return "ready";
	const lockPath = resolveSessionStartStatePaths(options.homeDir, projectRoot).lockPath;
	if (!liveBootstrapLock(lockPath, nowMs())) return "idle";
	const deadline = nowMs() + (options.timeoutMs ?? DEFAULT_INITIAL_GRAPH_TIMEOUT_MS);
	while (nowMs() < deadline) {
		await delay(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
		if (isGraphReady(probe(projectRoot))) return "ready";
	}
	return "bootstrap-in-flight-timeout";
}

function isGraphReady(state: CodegraphProjectState): boolean {
	return state.kind === "initialized" || state.kind === "nested-root";
}

function liveBootstrapLock(lockPath: string, nowMsValue: number): boolean {
	try {
		return nowMsValue - statSync(lockPath).mtimeMs < DEFAULT_SESSION_START_LOCK_STALE_MS;
	} catch {
		return false;
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolveDelay) => {
		setTimeout(resolveDelay, ms);
	});
}
