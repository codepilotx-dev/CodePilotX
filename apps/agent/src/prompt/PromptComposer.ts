import { createHash } from "node:crypto";
import type {
  PromptBundle,
  PromptCacheSegment,
  PromptComposeInput,
  PromptContextItem,
  PromptSection,
  PromptSectionDiagnostic,
} from "./types";

const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const bytes = (value: string) => Buffer.byteLength(value, "utf8");
const stableSerialize = (sections: readonly PromptSection[]) =>
  sections
    .map((item) => `${item.id}\0${item.role}\0${item.content}`)
    .join("\0\0");
const sourceLabel = (section: PromptSection) =>
  section.source.type === "file" ? section.source.path : section.source.name;

const reasonExcluded = (
  section: PromptSection,
  input: PromptComposeInput,
): PromptSectionDiagnostic["reason"] | undefined => {
  if (!section.content.trim()) return "empty";
  if (section.modes && !section.modes.includes(input.mode)) return "mode";
  if (section.profiles && !section.profiles.includes(input.profile))
    return "profile";
  if (
    section.requiredTools &&
    section.requiredTools.some((tool) => !input.exposedTools.includes(tool))
  )
    return "required-tools";
  return undefined;
};

const contextualItem = (section: PromptSection): PromptContextItem => ({
  role: "user",
  content: [
    {
      type: "input_text",
      text: `<context_data section_id=${JSON.stringify(section.id)} authority=${JSON.stringify(section.authority)} source=${JSON.stringify(sourceLabel(section))}>\n${section.content}\n</context_data>`,
    },
  ],
});

const instructionCacheSegments = (
  sections: readonly PromptSection[],
): PromptCacheSegment[] => {
  const result: PromptCacheSegment[] = [];
  let offset = 0;
  for (const section of sections) {
    const prefix = offset === 0 ? "" : "\n\n";
    const content = `${prefix}${section.content}`;
    const previous = result.at(-1);
    if (previous?.cache === section.cache && previous.role === "instructions") {
      previous.content += content;
      previous.sectionIDs.push(section.id);
      previous.end += content.length;
      previous.hash = hash(previous.content);
    } else {
      result.push({
        index: result.length,
        cache: section.cache,
        role: "instructions",
        sectionIDs: [section.id],
        content,
        hash: hash(content),
        start: offset,
        end: offset + content.length,
        cacheable: section.cache !== "dynamic",
      });
    }
    offset += content.length;
  }
  return result;
};

const contextCacheSegments = (
  sections: readonly PromptSection[],
  startIndex: number,
): PromptCacheSegment[] =>
  sections.map((section, index) => ({
    index: startIndex + index,
    cache: section.cache,
    role: "context",
    sectionIDs: [section.id],
    content: section.content,
    hash: hash(section.content),
    start: index,
    end: index + 1,
    // Context/evidence is deliberately never provider-cached, even if a caller misclassifies the section.
    cacheable: false,
  }));

/** Pure prompt assembly. Repository files and external evidence are emitted only as user context items. */
export class PromptComposer {
  compose(input: PromptComposeInput): PromptBundle {
    const diagnostics: PromptSectionDiagnostic[] = [];
    const included: PromptSection[] = [];
    for (const section of input.sections) {
      const reason = reasonExcluded(section, input);
      diagnostics.push({
        id: section.id,
        role: section.role,
        cache: section.cache,
        authority: section.authority,
        source: section.source,
        hash: hash(section.content),
        bytes: bytes(section.content),
        estimatedTokens: Math.ceil(section.content.length / 4),
        included: reason === undefined,
        ...(reason ? { reason } : {}),
      });
      if (!reason) included.push(section);
    }

    const instructionSections = included.filter(
      (section) => section.role !== "contextual-user",
    );
    const contextSections = included.filter(
      (section) => section.role === "contextual-user",
    );
    const instructions = instructionSections
      .map((section) => section.content)
      .join("\n\n");
    const stableSegments = instructionCacheSegments(instructionSections);
    const cacheSegments = [
      ...stableSegments,
      ...contextCacheSegments(contextSections, stableSegments.length),
    ];
    const firstDynamic = stableSegments.findIndex(
      (segment) => !segment.cacheable,
    );
    const stablePrefix = stableSegments.slice(
      0,
      firstDynamic < 0 ? stableSegments.length : firstDynamic,
    );
    const leadingGlobal = stablePrefix
      .filter(
        (segment, index) =>
          index === 0 ||
          stablePrefix
            .slice(0, index)
            .every((item) => item.cache === "global-stable"),
      )
      .filter((segment) => segment.cache === "global-stable");
    const globalEnd = leadingGlobal.at(-1)?.end;
    const sessionEnd = stablePrefix.at(-1)?.end;
    const cacheBoundaries = [
      ...(globalEnd
        ? [
            {
              segmentIndex: leadingGlobal.at(-1)!.index,
              cache: "global-stable" as const,
              offset: globalEnd,
              hash: hash(instructions.slice(0, globalEnd)),
            },
          ]
        : []),
      ...(sessionEnd && sessionEnd !== globalEnd
        ? [
            {
              segmentIndex: stablePrefix.at(-1)!.index,
              cache: "session-stable" as const,
              offset: sessionEnd,
              hash: hash(instructions.slice(0, sessionEnd)),
            },
          ]
        : []),
    ];
    return {
      instructions,
      contextItems: contextSections.map(contextualItem),
      diagnostics,
      cacheSegments,
      cacheBoundaries,
      baseHash: hash(stableSerialize(instructionSections)),
      contextHash: hash(stableSerialize(contextSections)),
      cacheHash: hash(
        cacheBoundaries
          .map(
            (boundary) =>
              `${boundary.cache}\0${boundary.offset}\0${boundary.hash}`,
          )
          .join("\0\0"),
      ),
      cacheKey: input.threadID,
    };
  }
}
