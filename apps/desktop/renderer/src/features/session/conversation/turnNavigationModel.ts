import type { RenderTurnEntry } from "@codepilotx/session-view";

export type ConversationTurnNavOutput = {
  type: "file";
  label: string;
  path: string;
};

export type ConversationTurnNavItem = {
  id: string;
  rowIndex: number;
  userText: string;
  assistantText: string | null;
  outputs: ConversationTurnNavOutput[];
};

export function deriveConversationTurnNavItems(
  turns: readonly RenderTurnEntry[],
): ConversationTurnNavItem[] {
  return turns.map((turn, rowIndex) => {
    const assistantText = turn.assistantResultItems
      .map((item) => item.text)
      .join("\n")
      .trim();

    return {
      id: turn.id,
      rowIndex,
      userText: turn.userInputs
        .map((input) => input.content)
        .join("\n")
        .trim(),
      assistantText: assistantText || null,
      outputs: collectFileOutputs(turn),
    };
  });
}

function collectFileOutputs(
  turn: RenderTurnEntry,
): ConversationTurnNavOutput[] {
  const outputs: ConversationTurnNavOutput[] = [];
  const seenPaths = new Set<string>();

  for (const patch of turn.patchItems) {
    for (const file of patch.files) {
      const path = file.path.trim();
      const normalizedPath = normalizePathForCompare(path);
      if (!normalizedPath || seenPaths.has(normalizedPath)) continue;
      seenPaths.add(normalizedPath);
      outputs.push({
        type: "file",
        label: fileName(path),
        path,
      });
    }
  }

  return outputs;
}

function normalizePathForCompare(path: string): string {
  return path.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}

function fileName(path: string): string {
  return path.replace(/\\/gu, "/").split("/").at(-1) || path;
}
