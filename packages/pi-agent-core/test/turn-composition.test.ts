import { describe, expect, test } from "bun:test";
import {
	createCompositionIdentity,
	createToolComposition,
	createTurnComposition,
	hashCompositionParts,
} from "../src/harness/turn-composition.ts";
import type { AgentHarnessStreamOptions } from "../src/harness/types.ts";
import type { Model } from "@earendil-works/pi-ai";

const fauxModel = (id: string): Model<any> => ({
	id,
	api: "openai-completions",
	provider: "faux",
	name: id,
	contextWindow: 64_000,
	maxTokens: 8_000,
	baseUrl: "",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

const baseStreamOptions = (): AgentHarnessStreamOptions => ({
	timeoutMs: 30_000,
	maxRetries: 1,
	cacheRetention: "long",
	metadata: { thread: "abc" },
});

describe("harness turn composition", () => {
	test("createTurnComposition freezes plain objects and arrays", () => {
		const composition = createTurnComposition<undefined>({
			compositionID: "rc:test:1",
			model: fauxModel("alpha"),
			thinkingLevel: "medium",
			systemPrompt: "system",
			tools: [],
			initialActiveNames: [],
			deferredAllowedNames: [],
			resources: {},
			toolContext: undefined,
			streamOptions: baseStreamOptions(),
		});
		expect(Object.isFrozen(composition)).toBe(true);
		expect(Object.isFrozen(composition.identity)).toBe(true);
		expect(Object.isFrozen(composition.toolPolicy)).toBe(true);
		expect(Object.isFrozen(composition.resources)).toBe(true);
		expect(Object.isFrozen(composition.streamOptions)).toBe(true);
		expect(composition.identity.version).toBe(1);
	});

	test("identity hash changes whenever any composition input changes", () => {
		const reference = createTurnComposition<undefined>({
			compositionID: "rc:test:1",
			model: fauxModel("alpha"),
			thinkingLevel: "medium",
			systemPrompt: "system",
			tools: [],
			initialActiveNames: [],
			deferredAllowedNames: [],
			resources: {},
			toolContext: undefined,
			streamOptions: baseStreamOptions(),
		});
		const sameModel = createTurnComposition<undefined>({
			compositionID: "rc:test:1",
			model: fauxModel("alpha"),
			thinkingLevel: "medium",
			systemPrompt: "system",
			tools: [],
			initialActiveNames: [],
			deferredAllowedNames: [],
			resources: {},
			toolContext: undefined,
			streamOptions: baseStreamOptions(),
		});
		expect(sameModel.identity.hash).toBe(reference.identity.hash);

		const differentModel = createTurnComposition<undefined>({
			compositionID: "rc:test:1",
			model: fauxModel("beta"),
			thinkingLevel: "medium",
			systemPrompt: "system",
			tools: [],
			initialActiveNames: [],
			deferredAllowedNames: [],
			resources: {},
			toolContext: undefined,
			streamOptions: baseStreamOptions(),
		});
		expect(differentModel.identity.hash).not.toBe(reference.identity.hash);

		const differentPrompt = createTurnComposition<undefined>({
			compositionID: "rc:test:1",
			model: fauxModel("alpha"),
			thinkingLevel: "medium",
			systemPrompt: "system-2",
			tools: [],
			initialActiveNames: [],
			deferredAllowedNames: [],
			resources: {},
			toolContext: undefined,
			streamOptions: baseStreamOptions(),
		});
		expect(differentPrompt.identity.hash).not.toBe(reference.identity.hash);
	});

	test("hashCompositionParts produces deterministic per-component hashes", () => {
		const partA = hashCompositionParts({
			model: fauxModel("alpha"),
			thinkingLevel: "medium",
			systemPrompt: "system",
			registeredTools: [],
			initialActiveNames: ["a"],
			deferredAllowedNames: ["b"],
			streamOptions: baseStreamOptions(),
		});
		const partB = hashCompositionParts({
			model: fauxModel("alpha"),
			thinkingLevel: "medium",
			systemPrompt: "system",
			registeredTools: [],
			initialActiveNames: ["a"],
			deferredAllowedNames: ["b"],
			streamOptions: baseStreamOptions(),
		});
		expect(partA).toEqual(partB);
	});

	test("createToolComposition freezes and stores registered/initial/deferred sets", () => {
		const tools = [{ name: "Read", label: "Read", description: "Read" }];
		const composition = createToolComposition({
			registeredTools: tools as never,
			initialActiveNames: ["Read"],
			deferredAllowedNames: ["Write"],
		});
		expect(Object.isFrozen(composition)).toBe(true);
		expect(Object.isFrozen(composition.registeredNames)).toBe(true);
		expect(Object.isFrozen(composition.initialActiveNames)).toBe(true);
		expect(Object.isFrozen(composition.deferredAllowedNames)).toBe(true);
		expect(composition.registeredNames).toEqual(["Read"]);
		expect(composition.initialActiveNames).toEqual(["Read"]);
		expect(composition.deferredAllowedNames).toEqual(["Write"]);
	});

	test("rejects duplicate and unknown tool policy names", () => {
		const tools = [{ name: "Read", label: "Read", description: "Read" }];
		expect(() => createToolComposition({
			registeredTools: [...tools, ...tools] as never,
			initialActiveNames: ["Read"],
			deferredAllowedNames: [],
		})).toThrow("Duplicate registered tool name");
		expect(() => createToolComposition({
			registeredTools: tools as never,
			initialActiveNames: ["Write"],
			deferredAllowedNames: [],
		})).toThrow("Unknown initial active tool");
		expect(() => createToolComposition({
			registeredTools: tools as never,
			initialActiveNames: ["Read"],
			deferredAllowedNames: ["Write", "Write"],
		})).toThrow("Duplicate deferred tool name");
	});

	test("createCompositionIdentity composes the overall hash from part hashes", () => {
		const partHashes = hashCompositionParts({
			model: fauxModel("alpha"),
			thinkingLevel: "low",
			systemPrompt: "system",
			registeredTools: [],
			initialActiveNames: ["a"],
			deferredAllowedNames: ["b"],
			streamOptions: baseStreamOptions(),
		});
		const identity = createCompositionIdentity({ compositionID: "rc:test:1", partHashes });
		expect(identity.id).toBe("rc:test:1");
		expect(identity.version).toBe(1);
		expect(identity.hash).toMatch(/^[a-f0-9]{64}$/);
		const recomputed = createCompositionIdentity({ compositionID: "rc:test:1", partHashes });
		expect(recomputed.hash).toBe(identity.hash);
	});
});
