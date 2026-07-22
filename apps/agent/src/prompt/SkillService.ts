import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const COMPATIBILITY_DIRS = [
  ".codepilotx",
  ".agents",
  ".codex",
  ".claude",
] as const;
const MAX_SKILL_BYTES = 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });
const skillNamePattern = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
  root: string;
  origin: "workspace" | "user";
  format: "codepilotx" | "agents" | "codex" | "claude";
  hash: string;
  metadata: Record<string, unknown>;
  allowedTools?: string[];
}

export interface LoadedSkill extends SkillMetadata {
  content: string;
  body: string;
}

export interface SkillCatalog {
  skills: SkillMetadata[];
  shadowed: Array<{ name: string; selectedPath: string; ignoredPath: string }>;
}

const contained = (root: string, candidate: string) => {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};
const sha256 = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const missing = (cause: unknown) =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

export const parseSkillDocument = (content: string) => {
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n"))
    return { metadata: {}, body: content };
  const normalized = content.replace(/\r\n/g, "\n");
  const rest = normalized.slice(4);
  const closing = /^---[ \t]*$/m.exec(rest);
  if (!closing || closing.index < 0)
    throw new Error("SKILL.md frontmatter 缺少结束分隔符");
  const parsed = parseYaml(rest.slice(0, closing.index), { maxAliasCount: 0 });
  if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed)))
    throw new Error("SKILL.md frontmatter 必须是 YAML mapping");
  const metadata = (parsed ?? {}) as Record<string, unknown>;
  const bodyStart = closing.index + closing[0].length;
  return { metadata, body: rest.slice(bodyStart).replace(/^\n/, "") };
};

const parseAllowedTools = (metadata: Record<string, unknown>) => {
  const value = metadata.allowedTools ?? metadata["allowed-tools"];
  const tools = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const normalized = [
    ...new Set(
      tools
        .map((tool) => (typeof tool === "string" ? tool.trim() : ""))
        .filter(Boolean),
    ),
  ];
  return normalized.length ? normalized : undefined;
};

export class SkillService {
  private catalog = new Map<string, SkillMetadata>();

  async scan(workspaceRoot: string, userRoot: string): Promise<SkillCatalog> {
    const workspace = await realpath(resolve(workspaceRoot));
    const user = await realpath(resolve(userRoot));
    const found = new Map<string, SkillMetadata>();
    const shadowed: SkillCatalog["shadowed"] = [];
    const bases = [
      { root: workspace, origin: "workspace" as const },
      { root: user, origin: "user" as const },
    ];

    for (const base of bases) {
      for (const compatibilityDir of COMPATIBILITY_DIRS) {
        const skillsRoot = join(base.root, compatibilityDir, "skills");
        let canonicalSkillsRoot: string;
        try {
          canonicalSkillsRoot = await realpath(skillsRoot);
        } catch (cause) {
          if (missing(cause)) continue;
          throw cause;
        }
        if (!contained(base.root, canonicalSkillsRoot))
          throw new Error(`Skills 根目录逃出配置根: ${skillsRoot}`);
        const entries = (
          await readdir(canonicalSkillsRoot, { withFileTypes: true })
        ).sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
          const directory = await realpath(
            join(canonicalSkillsRoot, entry.name),
          );
          if (!contained(canonicalSkillsRoot, directory))
            throw new Error(`Skill 目录逃出 Skills 根: ${entry.name}`);
          const documentPath = join(directory, "SKILL.md");
          let canonicalDocument: string;
          try {
            canonicalDocument = await realpath(documentPath);
          } catch (cause) {
            if (missing(cause)) continue;
            throw cause;
          }
          if (!contained(directory, canonicalDocument))
            throw new Error(`SKILL.md 逃出 Skill 根: ${documentPath}`);
          const bytes = await readFile(canonicalDocument);
          if (bytes.byteLength > MAX_SKILL_BYTES)
            throw new Error(`SKILL.md 超过 1 MiB: ${canonicalDocument}`);
          const content = decoder.decode(bytes);
          const parsed = parseSkillDocument(content);
          const declaredName = parsed.metadata.name;
          const name =
            typeof declaredName === "string" && declaredName
              ? declaredName
              : entry.name;
          if (!skillNamePattern.test(name))
            throw new Error(`无效 Skill 名称: ${name}`);
          const declaredDescription = parsed.metadata.description;
          const description =
            typeof declaredDescription === "string" ? declaredDescription : "";
          const allowedTools = parseAllowedTools(parsed.metadata);
          const metadata: SkillMetadata = {
            name,
            description,
            path: canonicalDocument,
            root: directory,
            origin: base.origin,
            format: compatibilityDir.slice(1) as SkillMetadata["format"],
            hash: sha256(bytes),
            metadata: parsed.metadata,
            ...(allowedTools ? { allowedTools } : {}),
          };
          const current = found.get(name);
          if (current)
            shadowed.push({
              name,
              selectedPath: current.path,
              ignoredPath: metadata.path,
            });
          else found.set(name, metadata);
        }
      }
    }
    this.catalog = found;
    return { skills: [...found.values()], shadowed };
  }

  list(): SkillMetadata[] {
    return [...this.catalog.values()];
  }

  /** Resolves explicit `$name` and `/name` invocations without treating ordinary prose as a Skill call. */
  resolveInvocation(value: string): SkillMetadata | null {
    const match = /^\s*[$/]([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?=\s|$)/.exec(
      value,
    );
    return match?.[1] ? (this.catalog.get(match[1]) ?? null) : null;
  }

  async read(name: string): Promise<LoadedSkill> {
    const metadata = this.catalog.get(name);
    if (!metadata) throw new Error(`未知 Skill: ${name}`);
    const bytes = await readFile(metadata.path);
    if (bytes.byteLength > MAX_SKILL_BYTES)
      throw new Error(`SKILL.md 超过 1 MiB: ${metadata.path}`);
    const content = decoder.decode(bytes);
    const parsed = parseSkillDocument(content);
    return { ...metadata, content, body: parsed.body };
  }

  allowedTools(name: string): readonly string[] | undefined {
    return this.catalog.get(name)?.allowedTools;
  }

  async resolveResource(name: string, resourcePath: string): Promise<string> {
    const metadata = this.catalog.get(name);
    if (!metadata) throw new Error(`未知 Skill: ${name}`);
    if (!resourcePath || isAbsolute(resourcePath))
      throw new Error("Skill 资源路径必须是相对路径");
    const lexical = resolve(metadata.root, resourcePath);
    if (!contained(metadata.root, lexical))
      throw new Error("Skill 资源路径逃出 Skill 根");
    const stats = await lstat(lexical);
    if (!stats.isFile() && !stats.isDirectory() && !stats.isSymbolicLink())
      throw new Error("Skill 资源类型不受支持");
    const canonical = await realpath(lexical);
    if (!contained(metadata.root, canonical))
      throw new Error("Skill 资源路径通过链接逃出 Skill 根");
    return canonical;
  }
}
