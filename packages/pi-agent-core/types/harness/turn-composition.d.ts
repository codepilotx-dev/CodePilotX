import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "../types.ts";
import type { AgentHarnessResources, AgentHarnessStreamOptions, AgentHarnessTool, HarnessCompositionIdentity, HarnessToolComposition, HarnessTurnComposition, PromptTemplate, Skill } from "./types.ts";
/** Compute the stable per-component hashes that compose a turn snapshot. */
export declare function hashCompositionParts(input: {
    model: Model<any>;
    thinkingLevel: ThinkingLevel;
    systemPrompt: string;
    registeredTools: readonly Pick<AgentHarnessTool<any>, "name" | "parameters">[];
    initialActiveNames: readonly string[];
    deferredAllowedNames: readonly string[];
    streamOptions: AgentHarnessStreamOptions;
}): {
    modelHash: string;
    thinkingHash: string;
    systemHash: string;
    toolsHash: string;
    initialActiveHash: string;
    deferredAllowedHash: string;
    streamOptionsHash: string;
};
/** Build a {@link HarnessCompositionIdentity} that uniquely names a turn snapshot. */
export declare function createCompositionIdentity(input: {
    compositionID: string;
    partHashes: ReturnType<typeof hashCompositionParts>;
}): HarnessCompositionIdentity;
/** Build a {@link HarnessToolComposition} description that the harness consumes. */
export declare function createToolComposition(input: {
    registeredTools: readonly Pick<AgentHarnessTool<any>, "name">[];
    initialActiveNames: readonly string[];
    deferredAllowedNames: readonly string[];
}): HarnessToolComposition;
/**
 * Build a {@link HarnessTurnComposition} from the candidate pieces. The returned
 * composition is fully immutable and ready for use as the harness envelope.
 */
export declare function createTurnComposition<TContext extends object | undefined, TSkill extends Skill = Skill, TPromptTemplate extends PromptTemplate = PromptTemplate, TTool extends AgentHarnessTool<TContext> = AgentHarnessTool<TContext>>(input: {
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
}): HarnessTurnComposition<TContext, TSkill, TPromptTemplate, TTool>;
//# sourceMappingURL=turn-composition.d.ts.map