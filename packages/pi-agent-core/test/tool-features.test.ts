import { describe, expect, test } from "bun:test";
import {
	Agent,
	AgentHarness,
	DeferredToolCatalog,
	InMemorySessionRepo,
	type AgentTool,
	type ExecutionEnv,
	type FileInfo,
} from "../src/index.ts";
import {
	Type,
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
	type Context,
} from "@earendil-works/pi-ai";

const ok = <T>(value: T) => ({ ok: true as const, value });

function createEnv(): ExecutionEnv {
	const fileInfo = (path: string): FileInfo => ({ name: path, path, kind: "file", size: 0, mtimeMs: 0 });
	return {
		cwd: "C:\\codepilotx-pi-test",
		absolutePath: async (path) => ok(path),
		joinPath: async (parts) => ok(parts.join("/")),
		readTextFile: async (path) => ({ ok: false, error: new Error(`Not found: ${path}`) as never }),
		readTextLines: async (path) => ({ ok: false, error: new Error(`Not found: ${path}`) as never }),
		readBinaryFile: async (path) => ({ ok: false, error: new Error(`Not found: ${path}`) as never }),
		writeFile: async () => ok(undefined),
		appendFile: async () => ok(undefined),
		fileInfo: async (path) => ok(fileInfo(path)),
		listDir: async () => ok([]),
		canonicalPath: async (path) => ok(path),
		exists: async () => ok(false),
		createDir: async () => ok(undefined),
		remove: async () => ok(undefined),
		createTempDir: async () => ok("C:\\tmp"),
		createTempFile: async () => ok("C:\\tmp\\file"),
		exec: async () => ok({ stdout: "", stderr: "", exitCode: 0 }),
		cleanup: async () => undefined,
	};
}

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
			streamFunction: models.streamSimple.bind(models),
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
		const deferredTool: AgentTool = {
			name: "deferred",
			label: "Deferred",
			description: "Loaded on demand",
			parameters: Type.Object({}),
			execute: async () => ({ content: [], details: {} }),
		};
		const catalog = new DeferredToolCatalog<AgentTool>([
			{ name: "deferred", label: "Deferred", description: "Loaded on demand", load: () => deferredTool },
		]);
		const discover: AgentTool = {
			name: "discover",
			label: "Discover",
			description: "Discovers deferred tools",
			parameters: Type.Object({}),
			execute: async (_id, _input, _signal, update) => {
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
		const harness = new AgentHarness({
			env: createEnv(),
			session,
			models: firstSetup.models,
			model: firstSetup.faux.getModel(),
			tools: [discover],
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
				return fauxAssistantMessage("restored");
			},
		]);
		const restored = new AgentHarness({
			env: createEnv(),
			session,
			models: secondSetup.models,
			model: secondSetup.faux.getModel(),
			tools: [discover],
			deferredToolCatalog: catalog,
		});
		await restored.prompt("continue");
		expect(restoredProviderTools).toEqual(["discover", "deferred"]);
		expect(restored.getActiveToolNames()).toEqual(["discover", "deferred"]);
	});
});
