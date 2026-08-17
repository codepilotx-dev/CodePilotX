/** 把权威 JSON Schema 文档写入 schema/ 目录（供跨语言 SDK 加载）。 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { applicationWireV1JsonSchema, manifestV1JsonSchema } from "../src/schema"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const schemaDir = join(root, "schema")
await mkdir(schemaDir, { recursive: true })

const manifestTarget = join(schemaDir, "plugin-manifest.v1.schema.json")
const wireTarget = join(schemaDir, "application-wire.v1.schema.json")
await writeFile(manifestTarget, `${JSON.stringify(manifestV1JsonSchema, null, 2)}\n`, "utf8")
await writeFile(wireTarget, `${JSON.stringify(applicationWireV1JsonSchema, null, 2)}\n`, "utf8")
console.log(`written ${manifestTarget}`)
console.log(`written ${wireTarget}`)
