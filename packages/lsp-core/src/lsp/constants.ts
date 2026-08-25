export const DEFAULT_MAX_REFERENCES = 200;
export const DEFAULT_MAX_SYMBOLS = 200;
export const DEFAULT_MAX_DIAGNOSTICS = 200;
export const DEFAULT_MAX_DIRECTORY_FILES = 50;

export const REQUEST_TIMEOUT_MS = 15_000;
export const INIT_TIMEOUT_MS = 60_000;
// Issue #6486: bounds spawn+initialize so async spawn death or a hung initialize fails in seconds, not at INIT_TIMEOUT_MS.
export const START_TIMEOUT_MS = 10_000;
export const START_TIMEOUT_ENV_VAR = "OMO_LSP_START_TIMEOUT_MS";
export const IDLE_TIMEOUT_MS = 5 * 60_000;
export const REAPER_INTERVAL_MS = 60_000;
export const STOP_HARD_KILL_TIMEOUT_MS = 5_000;
export const STOP_SIGKILL_GRACE_MS = 1_000;

export function resolveStartTimeoutMs(env: Record<string, string | undefined> = process.env): number {
	const raw = env[START_TIMEOUT_ENV_VAR];
	if (raw === undefined || raw.trim() === "") return START_TIMEOUT_MS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : START_TIMEOUT_MS;
}
