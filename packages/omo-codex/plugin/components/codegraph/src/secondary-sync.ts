import { runSessionStartCodegraphCommand } from "./session-start-command.js";

export const DEFAULT_SECONDARY_SYNC_DEBOUNCE_MS = 2_000;
export const SECONDARY_SYNC_TIMEOUT_MS = 30_000;

export interface CreateSecondaryRepoSyncOptions {
	readonly command: string;
	readonly env: Record<string, string>;
	readonly timeoutMs?: number;
}

// Issue #5588 (secondary repository staleness): CodeGraph caches repositories
// reached through a tool call's projectPath without watching them, so results
// go stale until a manual `codegraph sync`. The bridge refreshes such projects
// with the same bounded CLI invocation the SessionStart worker uses for init,
// best-effort: failures never block or fail the forwarded tool call.
export function createSecondaryRepoSyncFn(
	options: CreateSecondaryRepoSyncOptions,
): (projectRoot: string) => Promise<void> {
	return async (projectRoot) => {
		await runSessionStartCodegraphCommand(projectRoot, options.command, ["sync"], {
			env: options.env,
			timeoutMs: options.timeoutMs ?? SECONDARY_SYNC_TIMEOUT_MS,
		});
	};
}
