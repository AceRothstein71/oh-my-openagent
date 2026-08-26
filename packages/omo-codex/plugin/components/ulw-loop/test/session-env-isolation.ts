import { ULW_LOOP_SESSION_ENV_KEYS } from "../src/paths.js";

type UlwLoopSessionEnvKey = (typeof ULW_LOOP_SESSION_ENV_KEYS)[number];

export type UlwLoopSessionEnvSnapshot = Partial<Record<UlwLoopSessionEnvKey, string | undefined>>;

// The toolkit falls back to inherited session variables (OMO_ULW_LOOP_SESSION_ID,
// CODEX_SESSION_ID, CODEX_THREAD_ID, PI_SESSION_ID) whenever a command runs without an explicit
// --session-id. Hosts that set any of them (Codex Desktop exports CODEX_THREAD_ID) would otherwise
// re-scope plan and evidence dirs mid-suite, so every suite that drives the CLI clears all four
// keys up front and restores exactly what was there before.
export function captureAndClearUlwLoopSessionEnv(): UlwLoopSessionEnvSnapshot {
	const snapshot: UlwLoopSessionEnvSnapshot = {};
	for (const key of ULW_LOOP_SESSION_ENV_KEYS) {
		snapshot[key] = process.env[key];
		delete process.env[key];
	}
	return snapshot;
}

export function restoreUlwLoopSessionEnv(snapshot: UlwLoopSessionEnvSnapshot): void {
	for (const key of ULW_LOOP_SESSION_ENV_KEYS) {
		const value = snapshot[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}
