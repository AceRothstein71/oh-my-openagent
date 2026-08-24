#!/usr/bin/env node
// Dedicated mock provider for the collapse-recovery lane (issue #7135).
// Call 1 streams a runaway line-cycle repetition loop so the builtin TTSR
// collapse detector latches and aborts the run. Every call APPENDS the exact
// provider-visible message list to provider-requests.jsonl in the session cwd,
// so the driver can prove what the retry turn actually saw. Later calls answer
// normally so the TTSR nudge turn completes.
import { createLocalAssistantMessageEventStream } from "./mock-provider/index.ts";

declare const process: {
	cwd(): string;
	getBuiltinModule<T>(id: string): T;
};

interface FsModule {
	appendFileSync(path: string, data: string): void;
	readFileSync(path: string, encoding: string): string;
}

interface PathModule {
	join(...paths: string[]): string;
}

const { appendFileSync, readFileSync } = process.getBuiltinModule<FsModule>("fs");
const { join } = process.getBuiltinModule<PathModule>("path");

export const MODEL_ID = "mock-loop";
// Unique marker placed in the MIDDLE of the delivered body: inside neither the
// head (first 400 chars) nor the tail (last 600 of the remainder) excerpt window,
// so it survives ONLY if the aborted bubble reaches the provider unshrunk.
export const MIDDLE_SENTINEL = "MIDDLESENTINELXYZ7Q4";
export const BODY_HEAD_SENTINEL = "BODYHEADSENTINELaa11";
export const BODY_TAIL_SENTINEL = "BODYTAILSENTINELzz99";
export const RECOVERY_MARKER = "<collapse-recovery context>";

function buildLoopBody(): string {
	// Padding sentences stay unique: any repeated phrase here would trip the
	// collapse detector before the real squirt loop, cutting the body short.
	const parts: string[] = [];
	parts.push(`${BODY_HEAD_SENTINEL} This paragraph opens the explanation the user was reading.`);
	for (let i = 0; i < 12; i += 1) parts.push(`Padding sentence ${i} notes section ${i} of the walkthrough.`);
	parts.push(`${MIDDLE_SENTINEL} sits in the middle of the delivered body.`);
	for (let i = 0; i < 24; i += 1) parts.push(`Later paragraph ${i} expands topic ${i * 3 + 1} with distinct detail.`);
	parts.push(`${BODY_TAIL_SENTINEL} closes the delivered portion right before the loop.`);
	return parts.join(" ");
}

function baseMessage(): Record<string, unknown> {
	return {
		role: "assistant",
		content: [],
		api: "openai-completions",
		provider: "omo-collapse-mock",
		model: MODEL_ID,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
		timestamp: Date.now(),
	};
}

function requestCount(cwd: string): number {
	try {
		const raw = readFileSync(join(cwd, "provider-requests.jsonl"), "utf8");
		return raw.split("\n").filter((line) => line.trim() !== "").length + 1;
	} catch {
		return 1;
	}
}

function logRequest(cwd: string, context: unknown): void {
	const messages =
		typeof context === "object" && context !== null && Array.isArray(Reflect.get(context, "messages"))
			? Reflect.get(context, "messages")
			: [];
	appendFileSync(join(cwd, "provider-requests.jsonl"), `${JSON.stringify({ at: Date.now(), messages })}\n`);
}

export default function registerCollapseRecoveryMockProvider(pi: {
	registerProvider(id: string, provider: Record<string, unknown>): void;
}): void {
	pi.registerProvider("omo-collapse-mock", {
		name: "omo collapse-recovery mock provider",
		baseUrl: "file://collapse-recovery-mock-provider",
		apiKey: "mock",
		api: "openai-completions",
		models: [
			{
				id: MODEL_ID,
				name: "Mock Loop",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 8192,
			},
		],
		streamSimple(model: { id: string }, context: { cwd?: string }, options?: { signal?: AbortSignal }) {
			const stream = createLocalAssistantMessageEventStream();
			const cwd = context?.cwd ?? process.cwd();
			queueMicrotask(() => {
				// Count BEFORE logging: existing lines + 1 is THIS call's 1-based index.
				// Counting after the append would make call #1 see its own line and skip
				// the loop branch, so TTSR would never fire.
				const call = requestCount(cwd);
				logRequest(cwd, context);
				if (call <= 1) {
					streamLoop(stream, options?.signal);
					return;
				}
				const text = "Continuing with the remaining sections in compressed form.";
				const message = { ...baseMessage(), stopReason: "stop", content: [{ type: "text", text }] };
				stream.push({ type: "start", partial: { ...message, content: [] } });
				stream.push({ type: "text_start", contentIndex: 0, partial: { ...message, content: [{ type: "text", text: "" }] } });
				stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
				stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
				stream.push({ type: "done", reason: "stop", message });
				stream.end(message as never);
			});
			return stream;
		},
	});
}

const MAX_LOOP_CHUNKS = 2_000;

function streamLoop(
	stream: ReturnType<typeof createLocalAssistantMessageEventStream>,
	signal: AbortSignal | undefined,
): void {
	const { setTimeout } = process.getBuiltinModule<{ setTimeout(fn: () => void, ms: number): unknown }>("timers");
	const body = buildLoopBody();
	const message = { ...baseMessage(), content: [{ type: "text", text: body }] };
	stream.push({ type: "start", partial: { ...message, content: [] } });
	stream.push({ type: "text_start", contentIndex: 0, partial: { ...message, content: [{ type: "text", text: "" }] } });

	let chunks = 0;
	const pushChunk = (): void => {
		if (signal?.aborted || chunks >= MAX_LOOP_CHUNKS) {
			// A real runaway stream never completes: the engine's abort finalizes the
			// reply with stopReason "aborted", which is the shape the component detects.
			const aborted = { ...message, stopReason: "aborted" };
			stream.push({ type: "error", reason: "aborted", error: aborted });
			stream.end(aborted as never);
			return;
		}
		chunks += 1;
		if (chunks === 1) {
			stream.push({ type: "text_delta", contentIndex: 0, delta: body, partial: message });
		} else {
			stream.push({
				type: "text_delta",
				contentIndex: 0,
				delta: "squirt squirt\n".repeat(8),
				partial: message,
			});
		}
		setTimeout(pushChunk, 1);
	};
	pushChunk();
}
