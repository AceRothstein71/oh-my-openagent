import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, test } from "bun:test";

import { runMcpStdioServer } from "./mcp.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

interface CapturedResponse {
	body: string;
}

function collectingWritable(onLine: (line: string) => void): Writable {
	let buffer = "";
	return new Writable({
		write(chunk, _encoding, callback): void {
			buffer += typeof chunk === "string" ? chunk : String(chunk);
			let separator = buffer.indexOf("\n");
			while (separator !== -1) {
				const line = buffer.slice(0, separator).trim();
				if (line.length > 0) onLine(line);
				buffer = buffer.slice(separator + 1);
				separator = buffer.indexOf("\n");
			}
			callback();
		},
	});
}

describe("runMcpStdioServer request cwd", () => {
	test("#given LSP_TOOLS_MCP_CWD pointing at a session directory outside process.cwd() #when a write-path LSP tool targets a file inside it #then the path is not rejected by containment", async () => {
		// given
		const sessionDirectory = mkdtempSync(join(homedir(), "lsp-mcp-cwd-session-"));
		tempDirectories.push(sessionDirectory);
		const filePath = join(sessionDirectory, "module.wat");
		writeFileSync(filePath, "(module)\n", "utf-8");
		const responses: CapturedResponse[] = [];
		const output = collectingWritable((line) => responses.push({ body: line }));
		const input = Readable.from([
			`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } })}\n`,
			`${JSON.stringify({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "lsp_prepare_rename", arguments: { filePath, newName: "renamed.wat" } },
			})}\n`,
		]);
		const previousCwdEnv = process.env["LSP_TOOLS_MCP_CWD"];
		process.env["LSP_TOOLS_MCP_CWD"] = sessionDirectory;

		try {
			// when
			await runMcpStdioServer(input, output);
		} finally {
			if (previousCwdEnv === undefined) delete process.env["LSP_TOOLS_MCP_CWD"];
			else process.env["LSP_TOOLS_MCP_CWD"] = previousCwdEnv;
		}

		// then
		const toolCallResponse = responses.find((response) => response.body.includes('"id":2'));
		expect(toolCallResponse).toBeDefined();
		expect(toolCallResponse?.body).not.toContain("must be inside request cwd");
	});
});
