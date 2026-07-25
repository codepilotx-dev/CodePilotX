import { mkdir, rename, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { assertAgentBinaryHasNoStaticRiskFeatures } from "./agent-pe-signatures"
import { verifySrtRuntimeManifest } from "./verify-srt-runtime-manifest"

const root = resolve(import.meta.dir, "..")
const agentRoot = resolve(root, "apps/agent")
const outputDirectory = resolve(agentRoot, "dist/x64")
const output = resolve(outputDirectory, "codepilotx-agent.exe")
const temporaryOutput = `${output}.building.exe`
const legacyOutput = resolve(agentRoot, "dist/codepilotx-agent.exe")

await verifySrtRuntimeManifest(root)
await mkdir(outputDirectory, { recursive: true })
await rm(temporaryOutput, { force: true })

const build = Bun.spawn([
  "bun",
  "build",
  "src/index.ts",
  "--compile",
  "--target=bun-windows-x64",
  `--outfile=${temporaryOutput}`,
], {
  cwd: agentRoot,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

const exitCode = await build.exited
if (exitCode !== 0) process.exit(exitCode)

try {
  await assertAgentBinaryHasNoStaticRiskFeatures(temporaryOutput)
  await rm(output, { force: true })
  await rename(temporaryOutput, output)
  await rm(legacyOutput, { force: true })
  console.log(`[CodePilotX] Agent x64 PE verified: ${output}`)
} catch (error) {
  await rm(temporaryOutput, { force: true })
  throw error
}
