export async function getMemoryToolPrompt(): Promise<string> {
  return `## memory Tool

You have a persistent memory system accessible via the \`memory\` tool. Memories are stored as markdown files under the virtual \`/memories\` directory.

### Commands

- \`memory view /memories\` — List all memory files (MEMORY.md index + topic files). Shows frontmatter metadata (type, description) for each file.
- \`memory view /memories/MEMORY.md\` — Read the memory index file.
- \`memory view /memories/<topic>.md\` — Read a specific memory file.
- \`memory create path="/memories/<topic>.md" file_text="..."\` — Create a new memory file.
- \`memory str_replace path="/memories/<topic>.md" old_str="..." new_str="..."\` — Update content in a memory file (old_str must match exactly once).
- \`memory insert path="/memories/<topic>.md" insert_line=N new_str="..."\` — Insert content at a specific line.
- \`memory delete path="/memories/<topic>.md"\` — Delete a memory file.
- \`memory rename path="/memories/<topic>.md" new_path="/memories/<new-topic>.md"\` — Rename a memory file.

### Workflow

1. Start by viewing \`/memories/MEMORY.md\` to see the memory index.
2. View specific topic files as needed.
3. Use \`view /memories\` to discover available files when you don't know the exact filename.

### Guidelines

- Always check existing memories before creating new ones to avoid duplicates.
- Update existing memories rather than creating new ones when the topic already has a file.
- The \`/memories\` directory is persistent and carries across conversations.
- Memory files use markdown format with YAML frontmatter (type, description fields).`
}
