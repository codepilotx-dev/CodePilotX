import { describe, expect, test } from "bun:test";
import {
	Agent,
	AgentHarness,
	createTurnComposition,
	DeferredToolCatalog,
	InMemorySessionRepo,
	type AgentHarnessTool,
	type AgentTool,
} from "../src/index.ts";
import {
	Type,
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
	type Context,
} from "@earendil-works/pi-ai";

function setupProvider(responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0]) {
	const faux = fauxProvider({ models: [{ id: "test", input: ["text"], contextWindow: 64_000 }] });
	faux.setResponses(responses);
	const models = createModels();
	models.setProvider(faux.provider);
	return { faux, models };
}

describe("dynamic tool execution", () => {
	test("resolves mode from prepared and schema-validated input", async () => {
		let running = 0;
		let maxRunning = 0;
		const resolverInputs: unknown[] = [];
		const parameters = Type.Object({ serial: Type.Boolean() });
		const createTool = (name: string): AgentTool<typeof parameters> => ({
			name,
			label: name,
			description: name,
			parameters,
			prepareArguments: (input) => ({ serial: Boolean((input as { requiresSerial?: boolean }).requiresSerial) }),
			execute: async () => {
				running += 1;
				maxRunning = Math.max(maxRunning, running);
				await new Promise((resolve) => setTimeout(resolve, 10));
				running -= 1;
				return { structuredContent: { ok: true } };
			},
		});
		const tools = [createTool("first"), createTool("second")];
		const { faux, models } = setupProvider([
			fauxAssistantMessage(
				[fauxToolCall("first", { requiresSerial: true }), fauxToolCall("second", { requiresSerial: false })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		const agent = new Agent({
			initialState: { model: faux.getModel(), tools },
			streamFn: models.streamSimple.bind(models),
			toolExecution: async (input) => {
				resolverInputs.push(input);
				return (input as { serial: boolean }).serial ? "sequential" : "parallel";
			},
		});

		await agent.prompt("run");
		expect(resolverInputs).toEqual([{ serial: true }, { serial: false }]);
		expect(maxRunning).toBe(1);
	});
});

describe("DeferredToolCatalog", () => {
	test("searches metadata without loading and resolves exact names once", async () => {
		let loads = 0;
		const catalog = new DeferredToolCatalog<AgentTool>([
			{
				name: "repo_search",
				label: "Repository Search",
				description: "Search source files",
				load: async () => {
					loads += 1;
					return {
						name: "repo_search",
						label: "Repository Search",
						description: "Search source files",
						parameters: Type.Object({}),
						execute: async () => ({ content: [], details: {} }),
					};
				},
			},
		]);
		expect(catalog.search("repo_search", 1)[0]?.name).toBe("repo_search");
		expect(loads).toBe(0);
		expect((await catalog.resolve(["repo_search", "repo_search"])).map((tool) => tool.name)).toEqual(["repo_search"]);
		await catalog.activate(["repo_search"]);
		expect(loads).toBe(1);
		await expect(catalog.resolve(["missing"])).rejects.toThrow("Unknown deferred tool");
	});
});

describe("AgentHarness deferred activation", () => {
	test("activates result tools, preserves progress/structured content, and restores from session", async () => {
		type ToolContext = { workspace: string };
		let deferredToolContext: ToolContext | undefined;
		const deferredTool: AgentHarnessTool<ToolContext> = {
			name: "deferred",
			label: "Deferred",
			description: "Loaded on demand",
			parameters: Type.Object({}),
			execute: async (_id, _input, _signal, _update, context) => {
				deferredToolContext = context;
				return { content: [], details: {} };
			},
		};
		const catalog = new DeferredToolCatalog<AgentHarnessTool<ToolContext>>([
			{ name: "deferred", label: "Deferred", description: "Loaded on demand", load: () => deferredTool },
		]);
		const discover: AgentHarnessTool<ToolContext> = {
			name: "discover",
			label: "Discover",
			description: "Discovers deferred tools",
			parameters: Type.Object({}),
			execute: async (_id, _input, _signal, update, _context) => {
				update?.({ progress: { current: 1, total: 2, message: "searching" }, structuredContent: { phase: 1 } });
				return { structuredContent: { found: ["deferred"] }, addedToolNames: ["deferred"] };
			},
		};
		const firstSetup = setupProvider([
			fauxAssistantMessage(fauxToolCall("discover", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("activated"),
		]);
		const repo = new InMemorySessionRepo();
		const session = await repo.create({ id: crypto.randomUUID() });
		const composition = createTurnComposition<ToolContext>({
			compositionID: "rc:test:deferred:initial",
			model: firstSetup.faux.getModel(),
			thinkingLevel: "off",
			systemPrompt: "test",
			tools: [discover],
			initialActiveNames: ["discover"],
			deferredAllowedNames: ["deferred"],
			resources: {},
			toolContext: { workspace: "initial" },
			streamOptions: {},
		});
		const harness = new AgentHarness({
			session,
			models: firstSetup.models,
			composition,
			deferredToolCatalog: catalog,
		});
		const updates: unknown[] = [];
		const savePoints: string[][] = [];
		harness.subscribe((event) => {
			if (event.type === "tool_execution_update") updates.push(event.partialResult);
			if (event.type === "save_point") savePoints.push(event.activeToolNames);
		});

		await harness.prompt("discover");
		expect(harness.getActiveToolNames()).toEqual(["discover", "deferred"]);
		expect(updates).toEqual([
			{ progress: { current: 1, total: 2, message: "searching" }, structuredContent: { phase: 1 } },
		]);
		expect(savePoints.at(-1)).toEqual(["discover", "deferred"]);
		expect((await session.buildContext()).activeToolNames).toEqual(["discover", "deferred"]);

		let restoredProviderTools: string[] = [];
		const secondSetup = setupProvider([
			(context: Context) => {
				restoredProviderTools = context.tools?.map((tool) => tool.name) ?? [];
				return fauxAssistantMessage(fauxToolCall("deferred", {}), { stopReason: "toolUse" });
			},
			fauxAssistantMessage("restored"),
		]);
		const restoredComposition = createTurnComposition<ToolContext>({
			compositionID: "rc:test:deferred:restored",
			model: secondSetup.faux.getModel(),
			thinkingLevel: "off",
			systemPrompt: "test",
			tools: [discover],
			initialActiveNames: ["discover"],
			deferredAllowedNames: ["deferred"],
			resources: {},
			toolContext: { workspace: "restored" },
			streamOptions: {},
		});
		const restored = new AgentHarness({
			session,
			models: secondSetup.models,
			composition: restoredComposition,
			deferredToolCatalog: catalog,
		});
		await restored.prompt("continue");
		expect(restoredProviderTools).toEqual(["discover", "deferred"]);
		expect(restored.getActiveToolNames()).toEqual(["discover", "deferred"]);
		expect(deferredToolContext).toEqual({ workspace: "restored" });
	});

	test("rejects restored tools outside the frozen envelope", async () => {
		const setup = setupProvider([fauxAssistantMessage("unused")]);
		const repo = new InMemorySessionRepo();
		const session = await repo.create({ id: crypto.randomUUID() });
		await session.appendActiveToolsChange(["rogue"]);
		const harness = new AgentHarness({
			session,
			models: setup.models,
			composition: createTurnComposition({
				compositionID: "rc:test:restore-envelope",
				model: setup.faux.getModel(),
				thinkingLevel: "off",
				systemPrompt: "frozen",
				tools: [],
				initialActiveNames: [],
				deferredAllowedNames: [],
				resources: {},
				toolContext: undefined,
				streamOptions: {},
			}),
		});
		await expect(harness.prompt("resume")).rejects.toThrow("outside the composition envelope");
	});

	test("keeps identity, prompt and monotonic step indexes across provider samples", async () => {
		let harness!: AgentHarness;
		const mutationErrors: string[] = [];
		const tool: AgentHarnessTool<undefined> = {
			name: "sample_again",
			label: "Sample again",
			description: "forces a second sample",
			parameters: Type.Object({}),
			execute: async () => ({ content: [] }),
		};
		const setup = setupProvider([
			async (context: Context) => {
				try {
					await harness.setActiveTools([]);
				} catch (error) {
					mutationErrors.push((error as Error).message);
				}
				expect(context.systemPrompt).toBe("frozen prompt");
				return fauxAssistantMessage(fauxToolCall("sample_again", {}), { stopReason: "toolUse" });
			},
			(context: Context) => {
				expect(context.systemPrompt).toBe("frozen prompt");
				return fauxAssistantMessage("done");
			},
		]);
		const repo = new InMemorySessionRepo();
		const session = await repo.create({ id: crypto.randomUUID() });
		harness = new AgentHarness({
			session,
			models: setup.models,
			composition: createTurnComposition({
				compositionID: "rc:test:steps",
				model: setup.faux.getModel(),
				thinkingLevel: "off",
				systemPrompt: "frozen prompt",
				tools: [tool],
				initialActiveNames: ["sample_again"],
				deferredAllowedNames: [],
				resources: {},
				toolContext: undefined,
				streamOptions: {},
			}),
		});
		const steps: Array<{ id: string; hash: string; index: number }> = [];
		harness.on("before_provider_request", (event) => {
			steps.push({ id: event.compositionID, hash: event.compositionHash, index: event.stepIndex });
			return {};
		});
		await harness.prompt("run");
		expect(steps.map((step) => step.index)).toEqual([0, 1]);
		expect(new Set(steps.map((step) => step.id))).toEqual(new Set(["rc:test:steps"]));
		expect(new Set(steps.map((step) => step.hash)).size).toBe(1);
		expect(mutationErrors[0]).toContain("cannot change inside an active turn composition");
	});

	test("does not allow before_agent_start to replace the frozen prompt", async () => {
		const setup = setupProvider([fauxAssistantMessage("unused")]);
		const repo = new InMemorySessionRepo();
		const session = await repo.create({ id: crypto.randomUUID() });
		const harness = new AgentHarness({
			session,
			models: setup.models,
			composition: createTurnComposition({
				compositionID: "rc:test:hook-prompt",
				model: setup.faux.getModel(),
				thinkingLevel: "off",
				systemPrompt: "frozen",
				tools: [],
				initialActiveNames: [],
				deferredAllowedNames: [],
				resources: {},
				toolContext: undefined,
				streamOptions: {},
			}),
		});
		harness.on("before_agent_start", () => ({ systemPrompt: "replacement", messages: [] }));
		await expect(harness.prompt("run")).rejects.toThrow("must not replace the frozen system prompt");
	});
});

describe("AgentHarness live steering", () => {
	test("consumes stable input ids one at a time at model boundaries", async () => {
		let harness!: AgentHarness;
		const queued: Promise<void>[] = [];
		let requested = false;
		const setup = setupProvider([
			() => {
				if (!requested) {
					requested = true;
					queued.push(harness.steer("first steer", { inputId: "input:steer:first" }));
					queued.push(harness.steer("second steer", { inputId: "input:steer:second" }));
				}
				return fauxAssistantMessage("first sample");
			},
			fauxAssistantMessage("second sample"),
			fauxAssistantMessage("done"),
		]);
		const repo = new InMemorySessionRepo();
		const session = await repo.create({ id: crypto.randomUUID() });
		harness = new AgentHarness({
			session,
			models: setup.models,
			composition: createTurnComposition({
				compositionID: "rc:test:steering",
				model: setup.faux.getModel(),
				thinkingLevel: "off",
				systemPrompt: "steer test",
				tools: [],
				initialActiveNames: [],
				deferredAllowedNames: [],
				resources: {},
				toolContext: undefined,
				streamOptions: {},
			}),
		});
		const consumed: string[][] = [];
		harness.subscribe((event) => {
			if (event.type === "queue_consumed" && event.delivery === "steer") {
				consumed.push(event.inputIds);
			}
		});

		await harness.prompt("start");
		await Promise.all(queued);

		expect(consumed).toEqual([
			["input:steer:first"],
			["input:steer:second"],
		]);
	});
});
