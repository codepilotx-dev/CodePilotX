import { createHash } from "node:crypto"
import { resolve } from "node:path"

const baseURL = (process.env.CODEPILOTX_MODELS_URL ?? "https://models.dev").replace(/\/+$/, "")
const source = baseURL.endsWith("/api.json") ? baseURL : `${baseURL}/api.json`
const response = await fetch(source, { signal: AbortSignal.timeout(30_000) })
if (!response.ok) throw new Error(`models.dev returned ${response.status}`)

const catalog = await response.json()
const content = `${JSON.stringify(catalog, null, 2)}\n`
const sha256 = createHash("sha256").update(content).digest("hex")
const resources = resolve(import.meta.dir, "../resources")

await Bun.write(resolve(resources, "models.snapshot.json"), content)
await Bun.write(resolve(resources, "models.snapshot.meta.json"), `${JSON.stringify({
  source,
  generatedAt: new Date().toISOString(),
  sha256,
}, null, 2)}\n`)

console.log(`Updated models snapshot (${Object.keys(catalog as object).length} providers, sha256 ${sha256})`)
