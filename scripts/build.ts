import path from "node:path"
import { readdir, readFile, rm, writeFile } from "node:fs/promises"
const root = path.resolve(import.meta.dir, "..")
// Only generated output is removed; stale declarations must not mask missing emits.
await rm(path.join(root, "dist"), { recursive: true, force: true })
const result = await Bun.build({
  entrypoints: [path.join(root, "src/plugin.ts"), path.join(root, "src/sdk.ts")],
  outdir: path.join(root, "dist"),
  target: "node",
  format: "esm",
  packages: "external",
})
if (!result.success) throw new AggregateError(result.logs, "Build failed")
const declarations = Bun.spawn(["bun", "x", "--no-install", "tsc", "-p", "tsconfig.build.json"], { cwd: root, stdout: "inherit", stderr: "inherit" })
if (await declarations.exited !== 0) throw new Error("Declaration build failed")
async function inventory(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? inventory(file) : [file]
  }))).flat()
}
const files = new Set(await inventory(path.join(root, "dist/types")))
for (const file of files) {
  if (!file.endsWith(".d.ts")) continue
  const source = await readFile(file, "utf8")
  // Restrict replacements to emitted module specifiers, never arbitrary strings
  // or package imports. Resolve against the complete emitted declaration inventory.
  const rewritten = source.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.[^"']+)\2/g, (match, prefix: string, quote: string, specifier: string) => {
    const base = path.resolve(path.dirname(file), specifier)
    if (specifier.endsWith(".js") && files.has(base.slice(0, -3) + ".d.ts")) return match
    if (files.has(base + ".d.ts")) return `${prefix}${quote}${specifier}.js${quote}`
    if (files.has(path.join(base, "index.d.ts"))) return `${prefix}${quote}${specifier}/index.js${quote}`
    throw new Error(`Unresolved declaration module ${specifier} in ${path.relative(root, file)}`)
  })
  if (rewritten !== source) await writeFile(file, rewritten)
}
console.log("Built dist/plugin.js, dist/sdk.js and TypeScript declarations")
