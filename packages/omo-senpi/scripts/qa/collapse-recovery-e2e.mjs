#!/usr/bin/env node
// Live QA for the collapse-recovery component (issue #7135). Drives a real senpi
// process against an isolated agent directory and a repetition-loop mock provider,
// so the TTSR abort -> shrunk bubble -> dedup-context -> non-repeating retry path
// is proven end to end instead of being asserted at the seam.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mockProvider = join(scriptDir, "collapse-recovery-mock-provider.ts");
// scripts/qa -> scripts -> omo-senpi -> packages -> repo root: four levels, not three.
const repoRoot = resolve(join(scriptDir, "..", "..", "..", ".."));
const pluginRoot = join(repoRoot, "packages", "omo-senpi", "plugin");
const realSenpiAgentDir = join(homedir(), ".senpi", "agent");

const TRUNCATION_MARKER = "[output interrupted by stream rule]";
const RECOVERY_TYPE = "omo-collapse-recovery:context";
const TTSR_INJECTION_TYPE = "ttsr-injection";
const MIDDLE_SENTINEL = "MIDDLESENTINELXYZ7Q4";
const BODY_HEAD_SENTINEL = "BODYHEADSENTINELaa11";
const BODY_TAIL_SENTINEL = "BODYTAILSENTINELzz99";
const RECOVERY_MARKER = "<collapse-recovery context>";

function createSandbox() {
	const root = mkdtempSync(join(tmpdir(), "omo-senpi-collapse-qa-"));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	const xdgConfigHome = join(root, "xdg");
	const home = join(root, "home");
	return { root, cwd, agentDir, xdgConfigHome, home };
}

function seedSandbox(sandbox) {
	mkdirSync(sandbox.cwd, { recursive: true });
	mkdirSync(sandbox.agentDir, { recursive: true });
	mkdirSync(sandbox.home, { recursive: true });
	mkdirSync(sandbox.xdgConfigHome, { recursive: true });
	writeFileSync(
		join(sandbox.agentDir, "settings.json"),
		`${JSON.stringify({ defaultProjectTrust: "ask", packages: [pluginRoot] }, null, 2)}\n`,
	);
	writeFileSync(join(sandbox.agentDir, "trust.json"), `${JSON.stringify({ [sandbox.cwd]: true }, null, 2)}\n`);
}

function driveSenpi(senpiBin, sandbox, sessionDir) {
	return spawnSync(
		senpiBin,
		[
			"-e",
			mockProvider,
			"-p",
			"--provider",
			"omo-collapse-mock",
			"--model",
			"mock-loop",
			"--session-dir",
			sessionDir,
			"explain the onboarding architecture of this project in detail",
		],
		{
			cwd: sandbox.cwd,
			env: {
				...process.env,
				HOME: sandbox.home,
				USERPROFILE: sandbox.home,
				SENPI_CODING_AGENT_DIR: sandbox.agentDir,
				XDG_CONFIG_HOME: sandbox.xdgConfigHome,
				SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
				OMO_SENPI_QA: "1",
			},
			encoding: "utf8",
			timeout: 120_000,
			maxBuffer: 64 * 1024 * 1024,
		},
	);
}

function readSessionEntries(sessionDir) {
	if (!existsSync(sessionDir)) return [];
	const entries = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, name.name);
			if (name.isDirectory()) walk(full);
			else if (name.name.endsWith(".jsonl")) {
				for (const line of readFileSync(full, "utf8").split("\n")) {
					if (line.trim() === "") continue;
					try {
						entries.push(JSON.parse(line));
					} catch {
						// A partially flushed trailing line is not evidence either way.
					}
				}
			}
		}
	};
	walk(sessionDir);
	return entries;
}

function collectCustomTypes(value, depth = 0) {
	if (depth > 4 || typeof value !== "object" || value === null) return [];
	const found = [];
	for (const [key, nested] of Object.entries(value)) {
		if (key === "customType" && typeof nested === "string") found.push(nested);
		else found.push(...collectCustomTypes(nested, depth + 1));
	}
	return found;
}

function findCustomPayload(entry, customType) {
	const stack = [entry];
	while (stack.length > 0) {
		const current = stack.pop();
		if (typeof current !== "object" || current === null) continue;
		if (Reflect.get(current, "customType") === customType) return current;
		for (const nested of Object.values(current)) stack.push(nested);
	}
	return undefined;
}

function assistantMessages(entries) {
	return entries
		.filter((entry) => entry?.type === "message" && entry?.message?.role === "assistant")
		.map((entry) => entry.message);
}

function runScenario(senpiBin) {
	const sandbox = createSandbox();
	const sessionDir = join(sandbox.root, "sessions");
	mkdirSync(sessionDir, { recursive: true });
	seedSandbox(sandbox);
	try {
		const run = driveSenpi(senpiBin, sandbox, sessionDir);
		const entries = readSessionEntries(sessionDir);

		const assistants = assistantMessages(entries);
		const shrunkBubble = assistants.find((message) => {
			const content = message.content;
			return (
				message.stopReason === "aborted" &&
				Array.isArray(content) &&
				content.length === 1 &&
				content[0]?.type === "text" &&
				content[0]?.text === TRUNCATION_MARKER
			);
		});
		const unshrunkAborted = assistants.some(
			(message) =>
				message.stopReason === "aborted" &&
				JSON.stringify(message.content ?? "").includes(MIDDLE_SENTINEL),
		);

		const recoveryEntries = entries.filter((entry) => collectCustomTypes(entry).includes(RECOVERY_TYPE));
		const recoveryPayload = recoveryEntries.length > 0 ? findCustomPayload(recoveryEntries[0], RECOVERY_TYPE) : undefined;
		const ttsrNudges = entries.filter((entry) => collectCustomTypes(entry).includes(TTSR_INJECTION_TYPE));

		let retryRequest = null;
		const requestsPath = join(sandbox.cwd, "provider-requests.jsonl");
		if (existsSync(requestsPath)) {
			const lines = readFileSync(requestsPath, "utf8").split("\n").filter((line) => line.trim() !== "");
			retryRequest = lines.length >= 2 ? JSON.parse(lines[1]) : null;
		}
		const retryText = retryRequest === null ? "" : JSON.stringify(retryRequest);

		const exitOk = run.status === 0;
		const result = {
			exitStatus: run.status,
			exitOk,
			persistedShrunkBubble: shrunkBubble !== undefined,
			unshrunkAbortedBubble: unshrunkAborted,
			ttsrNudgeCount: ttsrNudges.length,
			recoveryContextCount: recoveryEntries.length,
			recoveryHidden: recoveryPayload?.display === false,
			retryRequestsCaptured: retryRequest !== null,
			retryCarriedDedupContext: retryText.includes(RECOVERY_MARKER),
			retryCarriedHeadExcerpt: retryText.includes(BODY_HEAD_SENTINEL),
			retryCarriedTailExcerpt: retryText.includes(BODY_TAIL_SENTINEL),
			retryStillCariedGarbledBody: retryText.includes(MIDDLE_SENTINEL),
			sandboxAgentDir: sandbox.agentDir,
			realAgentDirUntouched: !existsSync(realSenpiAgentDir) || resolve(realSenpiAgentDir) !== resolve(sandbox.agentDir),
			entries: entries.length,
			stderrTail: run.status === 0 ? undefined : String(run.stderr ?? "").slice(-600),
		};
		result.result =
			result.exitOk &&
			result.persistedShrunkBubble &&
			!result.unshrunkAbortedBubble &&
			result.ttsrNudgeCount >= 1 &&
			result.recoveryContextCount === 1 &&
			result.recoveryHidden &&
			result.retryRequestsCaptured &&
			result.retryCarriedDedupContext &&
			result.retryCarriedHeadExcerpt &&
			result.retryCarriedTailExcerpt &&
			!result.retryStillCariedGarbledBody
				? "PASS"
				: "FAIL";
		return result;
	} finally {
		try {
			existsSync(sandbox.root) && readdirSync(sandbox.root);
		} catch {
			// leave cleanup to the OS temp dir; never fail QA on cleanup
		}
	}
}

function selfTest() {
	const ok =
		typeof TRUNCATION_MARKER === "string" &&
		pluginRoot.endsWith(join("packages", "omo-senpi", "plugin")) &&
		existsSync(mockProvider) &&
		existsSync(join(pluginRoot, "extensions", "omo.js"));
	console.log(JSON.stringify({ selfTest: ok ? "PASS" : "FAIL", pluginRoot, mockProvider }));
	process.exit(ok ? 0 : 1);
}

const main = () => {
	if (process.argv.includes("--self-test")) {
		selfTest();
		return;
	}
	const senpiBin = process.env.SENPI_BIN?.trim() || "senpi";
	const result = runScenario(senpiBin);
	console.log(`collapse-recovery-e2e: ${result.result}`);
	console.log(JSON.stringify(result, null, 2));
	process.exit(result.result === "PASS" ? 0 : 1);
};

main();
