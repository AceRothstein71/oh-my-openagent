import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { runBridgedCodegraphProcess, type SecondaryRepoSyncHooks } from "../src/mcp-bridge.js";

function tempDir(): string {
	return mkdtempSync(join(import.meta.dir, ".tmp-secondary-sync-"));
}

function writeEchoChild(filePath: string): void {
	writeFileSync(
		filePath,
		[
			"#!/usr/bin/env bun",
			"const fs = require('node:fs');",
			"const rl = require('node:readline').createInterface({ input: process.stdin });",
			"rl.on('line', (line) => {",
			"  fs.appendFileSync(process.env.ECHO_LOG, line + '\\n');",
			"  const request = JSON.parse(line);",
			"  if (request.id !== undefined && request.id !== null) {",
			"    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: 'ack:' + request.id }] } }) + '\\n');",
			"  }",
			"});",
		].join("\n"),
	);
	chmodSync(filePath, 0o755);
}

function frameRequest(id: number, projectPath?: string): string {
	const args: Record<string, unknown> = { query: "q" };
	if (projectPath !== undefined) args["projectPath"] = projectPath;
	return `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "codegraph_explore", arguments: args } })}\n`;
}

interface BridgeRun {
	readonly ackIds: () => number[];
	readonly exitCode: Promise<number>;
	readonly receivedCount: () => number;
}

async function runBridge(options: {
	readonly childPath: string;
	readonly echoLog: string;
	readonly hooks: SecondaryRepoSyncHooks;
	readonly requests: string[];
}): Promise<BridgeRun> {
	const input = new PassThrough();
	const output = new PassThrough();
	const acks: number[] = [];
	output.on("data", (chunk: Buffer) => {
		for (const line of chunk.toString("utf8").split("\n")) {
			if (line.trim().length === 0) continue;
			try {
				const parsed = JSON.parse(line) as { id?: unknown };
				if (typeof parsed["id"] === "number") acks.push(parsed["id"]);
			} catch {
				// ignore partial chunks; assertions only need the final count
			}
		}
	});
	const exitCode = runBridgedCodegraphProcess(options.childPath, ["serve", "--mcp"], {
		cwd: import.meta.dir,
		env: { ECHO_LOG: options.echoLog, PATH: process.env["PATH"] ?? "" },
		input,
		output,
		stderr: { write: () => undefined },
		stdio: "pipe",
		secondaryRepoSync: options.hooks,
	});
	input.end(options.requests.join(""));
	const settled = await exitCode;
	return {
		ackIds: () => acks,
		exitCode: Promise.resolve(settled),
		receivedCount: () => readFileSync(options.echoLog, "utf8").split("\n").filter((line) => line.trim().length > 0).length,
	};
}

describe("runBridgedCodegraphProcess secondary repository sync", () => {
	it("#given tool calls targeting foreign projects #when requests are forwarded #then it syncs each foreign project once before forwarding and skips the default root", async () => {
		const tmp = tempDir();
		try {
			const childPath = join(tmp, "echo-child.cjs");
			const echoLog = join(tmp, "echo.log");
			writeFileSync(echoLog, "");
			writeEchoChild(childPath);
			const defaultRoot = join(tmp, "default-project");
			const foreignA = join(tmp, "foreign-a");
			const foreignB = join(tmp, "foreign-b");
			mkdirSyncAll([defaultRoot, foreignA, foreignB]);
			const syncCalls: string[] = [];
			const hooks: SecondaryRepoSyncHooks = {
				debounceMs: 60_000,
				defaultProjectRoot: defaultRoot,
				syncProject: (projectRoot) => {
					syncCalls.push(projectRoot);
					return Promise.resolve();
				},
			};

			const run = await runBridge({
				childPath,
				echoLog,
				hooks,
				requests: [
					frameRequest(1, foreignA),
					frameRequest(2, foreignA),
					frameRequest(3, foreignB),
					frameRequest(4, defaultRoot),
					frameRequest(5),
				],
			});

			expect(run.exitCode ? await run.exitCode : 0).toBe(0);
			expect(syncCalls.map((path) => realpathSync(path))).toEqual([realpathSync(foreignA), realpathSync(foreignB)]);
			expect(run.receivedCount()).toBe(5);
			expect(run.ackIds()).toEqual([1, 2, 3, 4, 5]);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("#given a failing secondary sync #when a tool call targets the foreign project #then it still forwards the request", async () => {
		const tmp = tempDir();
		try {
			const childPath = join(tmp, "echo-child.cjs");
			const echoLog = join(tmp, "echo.log");
			writeFileSync(echoLog, "");
			writeEchoChild(childPath);
			const defaultRoot = join(tmp, "default-project");
			const foreign = join(tmp, "foreign");
			mkdirSyncAll([defaultRoot, foreign]);
			const hooks: SecondaryRepoSyncHooks = {
				debounceMs: 60_000,
				defaultProjectRoot: defaultRoot,
				syncProject: () => Promise.reject(new Error("sync exploded")),
			};

			const run = await runBridge({
				childPath,
				echoLog,
				hooks,
				requests: [frameRequest(1, foreign)],
			});

			expect(await run.exitCode).toBe(0);
			expect(run.receivedCount()).toBe(1);
			expect(run.ackIds()).toEqual([1]);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("#given a slow secondary sync #when the first foreign tool call is answered #then the response arrives only after the sync completes", async () => {
		const tmp = tempDir();
		try {
			const childPath = join(tmp, "echo-child.cjs");
			const echoLog = join(tmp, "echo.log");
			writeFileSync(echoLog, "");
			writeEchoChild(childPath);
			const defaultRoot = join(tmp, "default-project");
			const foreign = join(tmp, "foreign");
			mkdirSyncAll([defaultRoot, foreign]);
			let syncCompletedAt = 0;
			const output = new PassThrough();
			let firstAckAt = 0;
			output.on("data", (chunk: Buffer) => {
				if (firstAckAt === 0 && chunk.toString("utf8").includes("ack:1")) firstAckAt = Date.now();
			});
			const input = new PassThrough();
			const hooks: SecondaryRepoSyncHooks = {
				debounceMs: 60_000,
				defaultProjectRoot: defaultRoot,
				syncProject: () =>
					new Promise<void>((resolveSync) => {
						setTimeout(() => {
							syncCompletedAt = Date.now();
							resolveSync();
						}, 50);
					}),
			};
			const exitCode = runBridgedCodegraphProcess(childPath, ["serve", "--mcp"], {
				cwd: import.meta.dir,
				env: { ECHO_LOG: echoLog, PATH: process.env["PATH"] ?? "" },
				input,
				output,
				stderr: { write: () => undefined },
				stdio: "pipe",
				secondaryRepoSync: hooks,
			});
			input.end(frameRequest(1, foreign));

			expect(await exitCode).toBe(0);
			expect(firstAckAt).toBeGreaterThanOrEqual(syncCompletedAt);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

function mkdirSyncAll(dirs: readonly string[]): void {
	for (const dir of dirs) mkdirSync(dir, { recursive: true });
}
