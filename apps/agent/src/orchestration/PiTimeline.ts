import { parseApplyPatch } from "../tool/ApplyPatch/parseApplyPatch"
import type { Item } from "../domain"
import type { PiRuntimeEventContext } from "./pi/types"

const safeTimelinePatchPath = (path: string) => {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (/^(?:[a-z]:\/|\/)/i.test(normalized) || parts.includes("..")) {
    return parts.at(-1) ?? "<workspace-file>";
  }
  return normalized || "<workspace-file>";
};

export type TimelineMutationFile = {
  path: string;
  additions: number;
  deletions: number;
};

const timelineToolName = (tool: string) => tool.toLowerCase().split(".").at(-1) ?? "";

const safeTimelineCount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;

const mutationToolKind = (tool: string) => {
  const name = timelineToolName(tool);
  return name === "apply_patch" || name === "write" || name === "edit"
    ? name
    : null;
};

export const piToolMutationFiles = (
  tool: string,
  details: unknown,
): TimelineMutationFile[] => {
  const kind = mutationToolKind(tool);
  if (!kind || !details || typeof details !== "object" || Array.isArray(details)) return [];
  const record = details as Record<string, unknown>;
  const candidates = kind === "apply_patch" && Array.isArray(record.files)
    ? record.files
    : [record];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const file = candidate as Record<string, unknown>;
    if (typeof file.path !== "string" || !file.path.trim()) return [];
    return [{
      path: safeTimelinePatchPath(file.path),
      additions: safeTimelineCount(file.additions),
      deletions: safeTimelineCount(file.deletions),
    }];
  });
};

const timelinePathKey = (path: string) => {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

export const mergeTimelineMutationFiles = (
  existing: readonly TimelineMutationFile[],
  incoming: readonly TimelineMutationFile[],
): TimelineMutationFile[] => {
  const merged = new Map<string, TimelineMutationFile>();
  for (const file of [...existing, ...incoming]) {
    const path = safeTimelinePatchPath(file.path);
    const key = timelinePathKey(path);
    const current = merged.get(key);
    merged.set(key, {
      path: current?.path ?? path,
      additions: (current?.additions ?? 0) + safeTimelineCount(file.additions),
      deletions: (current?.deletions ?? 0) + safeTimelineCount(file.deletions),
    });
  }
  return [...merged.values()];
};

export const piToolTimelineInput = (
  tool: string,
  input: unknown,
): Record<string, unknown> => {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const kind = mutationToolKind(tool);
  if (kind === "write") {
    const path = typeof record.file_path === "string"
      ? safeTimelinePatchPath(record.file_path)
      : "<workspace-file>";
    return {
      operation: "write",
      file_path: path,
      ...(typeof record.content === "string"
        ? { contentBytes: Buffer.byteLength(record.content, "utf8") }
        : {}),
      affectedPaths: [{ path }],
    };
  }
  if (kind === "edit") {
    const path = typeof record.path === "string"
      ? safeTimelinePatchPath(record.path)
      : "<workspace-file>";
    return {
      operation: "edit",
      path,
      ...(Array.isArray(record.edits) ? { editCount: record.edits.length } : {}),
      affectedPaths: [{ path }],
    };
  }
  if (kind !== "apply_patch") return record;
  const patch = typeof record.patch === "string" ? record.patch : "";
  let affectedPaths: Array<{
    path: string;
    operation: "create" | "update";
    additions: number;
    deletions: number;
  }> = [];
  let hunkCount = 0;
  let additions = 0;
  let deletions = 0;
  try {
    const operations = parseApplyPatch(patch);
    affectedPaths = operations.map((operation) => {
      const fileAdditions = operation.type === "add"
        ? operation.content.endsWith("\n")
          ? operation.content.slice(0, -1).split("\n").length
          : operation.content.split("\n").length
        : operation.chunks.reduce((sum, chunk) => sum + chunk.additions, 0);
      const fileDeletions = operation.type === "add"
        ? 0
        : operation.chunks.reduce((sum, chunk) => sum + chunk.deletions, 0);
      return {
        path: safeTimelinePatchPath(operation.path),
        operation: operation.type === "add" ? "create" : "update",
        additions: fileAdditions,
        deletions: fileDeletions,
      };
    });
    additions = affectedPaths.reduce((sum, file) => sum + file.additions, 0);
    deletions = affectedPaths.reduce((sum, file) => sum + file.deletions, 0);
    hunkCount = operations.reduce(
      (sum, operation) => sum + (operation.type === "add" ? 0 : operation.chunks.length),
      0,
    );
  } catch {
    // Invalid patches still get a safe timeline item; the tool result carries the actionable parse error.
  }
  return {
    operation: "apply_patch",
    patchBytes: Buffer.byteLength(patch, "utf8"),
    hunkCount,
    additions,
    deletions,
    patch: "[补丁正文已隐藏]",
    ...(affectedPaths.length ? { affectedPaths } : {}),
  };
};

const commandFromInput = (input: unknown) => input && typeof input === "object"
  && typeof (input as Record<string, unknown>).command === "string"
  ? (input as Record<string, unknown>).command as string
  : null;

export const piToolItemPayload = (item: Item) => {
  const data = item.data;
  const terminal = item.status === "completed" || item.status === "error" || item.status === "interrupted";
  return {
    id: item.id,
    messageID: item.turnID,
    turnId: item.turnID,
    agentId: item.agentID,
    type: "tool" as const,
    callID: typeof data.callID === "string" ? data.callID : item.id,
    tool: typeof data.tool === "string" ? data.tool : "tool",
    title: typeof data.title === "string" ? data.title : `运行了 ${typeof data.tool === "string" ? data.tool : "tool"}`,
    state: item.status === "pending" ? "pending" as const
      : item.status === "running" ? "running" as const
      : item.status === "error" ? "error" as const
      : item.status === "interrupted" ? "interrupted" as const
      : "completed" as const,
    input: data.input ?? null,
    command: typeof data.command === "string" ? data.command : null,
    output: typeof data.output === "string" ? data.output : null,
    error: typeof data.error === "string" ? data.error : null,
    startedAt: typeof data.startedAt === "number" ? data.startedAt : item.createdAt,
    finishedAt: typeof data.finishedAt === "number" ? data.finishedAt : terminal ? item.updatedAt : null,
    durationMs: typeof data.durationMs === "number" ? data.durationMs : terminal ? item.updatedAt - item.createdAt : null,
    ...(item.ordinal === undefined ? {} : { ordinal: item.ordinal }),
    createdAt: item.createdAt,
  };
};

export const finishedPiToolItem = (input: {
  current: Item | null;
  turnID: string;
  agentID: string;
  toolCallID: string;
  tool: string;
  output: string;
  isError: boolean;
  timestamp: number;
}): Item | null => {
  if (input.current && ["completed", "error", "interrupted"].includes(input.current.status)) return null;
  const createdAt = input.current?.createdAt ?? input.timestamp;
  return {
    id: input.toolCallID,
    turnID: input.turnID,
    agentID: input.agentID,
    type: "tool",
    status: input.isError ? "error" : "completed",
    data: {
      ...(input.current?.data ?? {}),
      callID: input.toolCallID,
      tool: input.tool,
      title: input.tool,
      state: input.isError ? "error" : "completed",
      output: input.isError ? null : input.output,
      error: input.isError ? input.output : null,
      finishedAt: input.timestamp,
      durationMs: input.timestamp - createdAt,
    },
    createdAt,
    updatedAt: input.timestamp,
  };
};

export const piItemDeltaPayload = (input: {
  itemID: string;
  context: PiRuntimeEventContext;
  delta: string;
}) => ({
  itemId: input.itemID,
  turnId: input.context.turnID,
  agentId: input.context.agentID,
  delta: input.delta,
});

export { commandFromInput, safeTimelinePatchPath, timelinePathKey };
