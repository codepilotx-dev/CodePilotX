import { createHash } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "../types.ts";
import type {
	AgentHarnessResources,
	AgentHarnessStreamOptions,
	AgentHarnessTool,
	HarnessCompositionIdentity,
	HarnessToolComposition,
	HarnessTurnComposition,
	PromptTemplate,
	Skill,
} from "./types.ts";

const stableStringify = (value: unknown): string => {
	const seen = new WeakSet<object>();
	const walk = (entry: unknown): unknown => {
		if (entry === null || typeof entry !== "object") return entry;
		if (seen.has(entry as object)) return null;
		seen.add(entry as object);
		if (Array.isArray(entry)) return entry.map(walk);
		const record = entry as Record<string, unknown>;
		const next: Record<string, unknown> = {};
		for (const key of Object.keys(record).sort()) {
			next[key] = walk(record[key] ?? null);
		}
		return next;
	};
	return JSON.stringify(walk(value));
};

const sha256 = (value: string) =>
	createHash("sha256").update(value, "utf8").digest("hex");

const freezeArray = <T>(values: readonly T[]): readonly T[] => Object.freeze([...values]);

/** Compute the stable per-component hashes that compose a turn snapshot. */
export function hashCompositionParts(input: {
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	systemPrompt: string;
	registeredTools: readonly Pick<AgentHarnessTool<any>, "name" | "parameters">[];
	initialActiveNames: readonly string[];
	deferredAllowedNames: readonly string[];
	streamOptions: AgentHarnessStreamOptions;
}) {
	const modelHash = sha256(stableStringify({
		id: input.model.id,
		provider: input.model.provider,
		api: input.model.api,
		contextWindow: input.model.contextWindow,
	}));
	const thinkingHash = sha256(input.thinkingLevel);
	const systemHash = sha256(input.systemPrompt);
	const toolsHash = sha256(
		input.registeredTools
			.map((tool) => `${tool.name}\0${sha256(stableStringify(tool.parameters ?? null))}`)
			.join("\0\0"),
	);
	const initialActiveHash = sha256(input.initialActiveNames.join("\0"));
	const deferredAllowedHash = sha256(input.deferredAllowedNames.join("\0"));
	const streamOptionsHash = sha256(stableStringify(input.streamOptions));
	return {
		modelHash,
		thinkingHash,
		systemHash,
		toolsHash,
		initialActiveHash,
		deferredAllowedHash,
		streamOptionsHash,
	};
}

/** Build a {@link HarnessCompositionIdentity} that uniquely names a turn snapshot. */
export function createCompositionIdentity(input: {
	compositionID: string;
	partHashes: ReturnType<typeof hashCompositionParts>;
}): HarnessCompositionIdentity {
	const overall = sha256(
		[
			input.compositionID,
			input.partHashes.modelHash,
			input.partHashes.thinkingHash,
			input.partHashes.systemHash,
			input.partHashes.toolsHash,
			input.partHashes.initialActiveHash,
			input.partHashes.deferredAllowedHash,
			input.partHashes.streamOptionsHash,
		].join("\0\u0002"),
	);
	return {
		id: input.compositionID,
		version: 1,
		hash: overall,
	};
}

/** Build a {@link HarnessToolComposition} description that the harness consumes. */
export function createToolComposition(input: {
	registeredTools: readonly Pick<AgentHarnessTool<any>, "name">[];
	initialActiveNames: readonly string[];
	deferredAllowedNames: readonly string[];
}): HarnessToolComposition {
	const registeredNames = input.registeredTools.map((tool) => tool.name);
	const assertUnique = (names: readonly string[], label: string) => {
		const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
		if (duplicates.length > 0) throw new Error(`${label}: ${[...new Set(duplicates)].join(", ")}`);
	};
	assertUnique(registeredNames, "Duplicate registered tool name(s)");
	assertUnique(input.initialActiveNames, "Duplicate initial active tool name(s)");
	assertUnique(input.deferredAllowedNames, "Duplicate deferred tool name(s)");
	const registered = new Set(registeredNames);
	const unknownInitial = input.initialActiveNames.filter((name) => !registered.has(name));
	if (unknownInitial.length > 0) throw new Error(`Unknown initial active tool(s): ${unknownInitial.join(", ")}`);
	return Object.freeze({
		registeredNames: freezeArray(registeredNames),
		initialActiveNames: freezeArray(input.initialActiveNames),
		deferredAllowedNames: freezeArray(input.deferredAllowedNames),
	});
}

/**
 * Build a {@link HarnessTurnComposition} from the candidate pieces. The returned
 * composition is fully immutable and ready for use as the harness envelope.
 */
export function createTurnComposition<
	TContext extends object | undefined,
	TSkill extends Skill = Skill,
	TPromptTemplate extends PromptTemplate = PromptTemplate,
	TTool extends AgentHarnessTool<TContext> = AgentHarnessTool<TContext>,
>(input: {
	compositionID: string;
	compositionHash?: string;
	compositionVersion?: number;
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	systemPrompt: string;
	tools: readonly TTool[];
	initialActiveNames: readonly string[];
	deferredAllowedNames: readonly string[];
	resources: Readonly<AgentHarnessResources<TSkill, TPromptTemplate>>;
	toolContext: TContext;
	streamOptions: AgentHarnessStreamOptions;
}): HarnessTurnComposition<TContext, TSkill, TPromptTemplate, TTool> {
	const toolsForHashing = input.tools.map((tool) => ({
		name: tool.name,
		parameters: tool.parameters ?? null,
	}));
	const partHashes = hashCompositionParts({
		model: input.model,
		thinkingLevel: input.thinkingLevel,
		systemPrompt: input.systemPrompt,
		registeredTools: toolsForHashing,
		initialActiveNames: input.initialActiveNames,
		deferredAllowedNames: input.deferredAllowedNames,
		streamOptions: input.streamOptions,
	});
	const computedIdentity = createCompositionIdentity({ compositionID: input.compositionID, partHashes });
	const identity: HarnessCompositionIdentity = {
		id: input.compositionID,
		version: input.compositionVersion ?? computedIdentity.version,
		hash: input.compositionHash ?? computedIdentity.hash,
	};
	const toolPolicy = createToolComposition({
		registeredTools: toolsForHashing,
		initialActiveNames: input.initialActiveNames,
		deferredAllowedNames: input.deferredAllowedNames,
	});
	const frozenTools = freezeArray(input.tools);
	const frozenResources = Object.freeze({
		skills: input.resources.skills ? freezeArray(input.resources.skills) : undefined,
		promptTemplates: input.resources.promptTemplates
			? freezeArray(input.resources.promptTemplates)
			: undefined,
	}) as Readonly<AgentHarnessResources<TSkill, TPromptTemplate>>;
	const frozenStreamOptions = Object.freeze({
		...input.streamOptions,
		headers: input.streamOptions.headers ? Object.freeze({ ...input.streamOptions.headers }) : undefined,
		metadata: input.streamOptions.metadata ? Object.freeze({ ...input.streamOptions.metadata }) : undefined,
	});
	const frozenModel = Object.freeze({ ...input.model }) as Model<any>;
	return Object.freeze({
		identity: Object.freeze(identity),
		model: frozenModel,
		thinkingLevel: input.thinkingLevel,
		systemPrompt: input.systemPrompt,
		tools: frozenTools as readonly TTool[],
		toolPolicy,
		resources: frozenResources,
		toolContext: input.toolContext,
		streamOptions: frozenStreamOptions,
	});
}
