import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const provenance = JSON.parse(await readFile(path.join(root, "vendor/provenance.json"), "utf8"))
const manifest = JSON.parse(await readFile(path.join(root, "vendor/patches/manifest.json"), "utf8"))
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
assert(provenance.tree === "aec0b9a6d8898f68f923aaf08b7306d931fd9d76" && provenance.tag === "v1.18.34", "Wrong upstream pin")
assert(manifest.format === 1 && manifest.patches.length === 4, "Wrong patch inventory")
assert(manifest.patches[0].class === "stateless-no-id-encrypted-replay" && manifest.patches[1].class === "stateless-no-id-encrypted-replay" && manifest.patches[2].class === "exact-target-reasoning-classification" && manifest.patches[3].class === "same-index-encrypted-reasoning-retention", "Unauthorized patch classes")
assert(manifest.patches[0].file === "vendor/copilot/responses/openai-responses-api-types.ts" && manifest.patches[1].file === "vendor/copilot/responses/convert-to-openai-responses-input.ts" && manifest.patches[2].file === "vendor/copilot/responses/openai-responses-language-model.ts" && manifest.patches[3].file === "vendor/copilot/responses/openai-responses-language-model.ts", "Unauthorized patch paths")
const inventory = new Set<string>(provenance.files.map((file: { local: string }) => file.local))
assert(inventory.size === 26 && provenance.files.length === 26, "Wrong upstream inventory")
for (const patch of manifest.patches) assert(inventory.has(patch.file), "Unknown patch file")
let importCount = 0
for (const file of provenance.files) {
  const local = await readFile(path.join(root, file.local), "utf8")
  let pristine = local
  const patches = manifest.patches.filter((patch: { file: string }) => patch.file === file.local)
  for (const patch of [...patches].reverse()) {
    assert(pristine.split(patch.after).length === 2, `Patch not uniquely present: ${file.local}`)
    pristine = pristine.replace(patch.after, patch.before)
  }
  const bytes = Buffer.from(pristine)
  assert(createHash("sha256").update(bytes).digest("hex") === file.pristineSha256, `Pristine SHA-256 mismatch: ${file.local}`)
  assert(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") === file.blob, `Git blob mismatch: ${file.local}`)
  assert(file.origin === `https://raw.githubusercontent.com/anomalyco/opencode/${provenance.tree}/${file.source}`, `Wrong immutable origin: ${file.local}`)
  let reproduced = pristine
  for (const patch of patches) {
    assert(reproduced.split(patch.before).length === 2, `Patch baseline ambiguous: ${file.local}`)
    reproduced = reproduced.replace(patch.before, patch.after)
  }
  assert(reproduced === local, `Patch reproduction mismatch: ${file.local}`)
  if (!file.local.endsWith(".ts")) continue
  for (const match of local.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)) {
    const specifier = match[1]!
    if (specifier.startsWith(".")) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.local), specifier)) + ".ts"
      assert(inventory.has(resolved), `Import outside vendored inventory: ${specifier}`)
    } else {
      assert(["@ai-sdk/provider", "@ai-sdk/provider-utils", "zod", "zod/v4"].includes(specifier), `Unexpected dependency: ${specifier}`)
    }
    importCount++
  }
}
async function list(directory: string): Promise<string[]> {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true })
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? list(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat()
}
assert((await list("vendor/copilot")).every(file => inventory.has(file)), "Unrecorded adapter file")
console.log(`Verified 25 adapter files + LICENSE; 26 pristine SHA-256/Git blobs; 4 reproducible replacements in 3 patch classes; ${importCount} closed imports. Offline; no network required.`)
