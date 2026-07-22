import type { AgentTool } from "../types.ts";
export interface DeferredToolSummary {
    name: string;
    label: string;
    description: string;
}
export type DeferredToolLoader<TTool extends AgentTool = AgentTool> = () => TTool | Promise<TTool>;
export interface DeferredToolCatalogEntry<TTool extends AgentTool = AgentTool> extends DeferredToolSummary {
    load: DeferredToolLoader<TTool>;
}
/**
 * Searchable catalog whose tool implementations are loaded only when selected.
 * Search never loads tools. `resolve()` and `activate()` require exact names and
 * reject unknown entries so callers cannot silently expose the wrong tool.
 */
export declare class DeferredToolCatalog<TTool extends AgentTool = AgentTool> {
    private readonly entries;
    private readonly resolved;
    private readonly loading;
    constructor(entries?: Iterable<DeferredToolCatalogEntry<TTool>>);
    register(entry: DeferredToolCatalogEntry<TTool>): this;
    has(name: string): boolean;
    search(query: string, limit?: number): DeferredToolSummary[];
    resolve(names: readonly string[]): Promise<TTool[]>;
    /** Resolve tool implementations selected for activation. */
    activate(names: readonly string[]): Promise<TTool[]>;
}
//# sourceMappingURL=deferred-tool-catalog.d.ts.map