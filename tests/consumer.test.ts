import { expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"

const root = path.resolve(import.meta.dir, "..")
async function build() {
  const child = Bun.spawn(["bun", "run", "build"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect({ code, error: code === 0 ? "" : stdout + stderr }).toEqual({ code: 0, error: "" })
}
async function snapshot(directory: string): Promise<Record<string, string>> {
  const entries = await readdir(directory, { withFileTypes: true })
  const result: Record<string, string> = {}
  for (const entry of entries) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) Object.assign(result, await snapshot(file))
    else result[path.relative(root, file)] = await readFile(file, "utf8")
  }
  return result
}

test("repeat builds discard stale artifacts and reproduce the complete distribution", async () => {
  await build()
  const first = await snapshot(path.join(root, "dist"))
  await writeFile(path.join(root, "dist/types/stale.d.ts"), "export type Stale = never\n")
  await build()
  expect(await snapshot(path.join(root, "dist"))).toEqual(first)
}, 30000)

test("production tarball NodeNext consumer resolves both exports without checkout or Bun ambient types", async () => {
  await build()
  const fixture = await mkdtemp(path.join(tmpdir(), "gpt-reasoning-consumer-"))
  try {
    await writeFile(path.join(fixture, "package.json"), '{"private":true,"type":"module"}\n')
    const pack = Bun.spawn(["npm", "pack", "--json", "--ignore-scripts", "--pack-destination", fixture], { cwd: root, stdout: "pipe", stderr: "pipe" })
    const [packed, packError, packCode] = await Promise.all([new Response(pack.stdout).text(), new Response(pack.stderr).text(), pack.exited])
    expect({ code: packCode, error: packCode === 0 ? "" : packError }).toEqual({ code: 0, error: "" })
    const artifact = JSON.parse(packed)[0]
    const files: string[] = artifact.files.map((file: { path: string }) => file.path)
    expect(files).toContain("dist/plugin.js")
    expect(files).toContain("dist/sdk.js")
    expect(files).toContain("LICENSE")
    expect(files).toContain("vendor/provenance.json")
    expect(files).toContain("vendor/patches/manifest.json")
    expect(files.every(file => ["package.json", "LICENSE", "README.md", "docs/compatibility.md", "docs/maintenance.md"].includes(file) || file.startsWith("dist/") || file.startsWith("vendor/"))).toBe(true)
    const install = Bun.spawn(["npm", "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", path.join(fixture, artifact.filename), "@types/node@26.6.4"], { cwd: fixture, stdout: "pipe", stderr: "pipe" })
    const [installed, installError, installCode] = await Promise.all([new Response(install.stdout).text(), new Response(install.stderr).text(), install.exited])
    expect({ code: installCode, error: installCode === 0 ? "" : installed + installError }).toEqual({ code: 0, error: "" })
    expect(await readdir(path.join(fixture, "node_modules/@types"))).not.toContain("bun")
    await writeFile(path.join(fixture, "consumer.ts"), `
import plugin from "opencode-gpt-reasoning"
import { createCopilotReasoning, createOpenaiCompatible } from "opencode-gpt-reasoning/sdk"
import type { Plugin } from "@opencode-ai/plugin"
const typedPlugin: Plugin = plugin
const sdk = createCopilotReasoning({ name: "github-copilot", headers: { "x-fixture": "kept" } })
const sameFactory: typeof createCopilotReasoning = createOpenaiCompatible
const model = sdk.responses("gpt-6-luna")
const provider: string = model.provider
model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "fixture" }] }] })
// @ts-expect-error model identifiers are strings
sdk.responses(123)
// @ts-expect-error provider headers must contain string values
sameFactory({ headers: { invalid: 123 } })
void typedPlugin; void provider
`)
    const child = Bun.spawn([path.join(root, "node_modules/.bin/tsc"), "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "false", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "esnext", "--types", "node", "consumer.ts"], { cwd: fixture, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect({ code, diagnostics: stdout + stderr }).toEqual({ code: 0, diagnostics: "" })
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
}, 60000)
