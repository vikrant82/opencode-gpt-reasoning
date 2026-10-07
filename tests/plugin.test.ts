import { expect, test } from "bun:test"
import type { Config, PluginInput } from "@opencode-ai/plugin"
import type { Provider, Model } from "@opencode-ai/sdk/v2"
import plugin from "../src/plugin"
import { isTarget } from "../src/targets"

function model(id: string, providerID = "github-copilot"): Model {
  return { id, providerID, api: { id, url: "https://fixture.invalid", npm: "@ai-sdk/github-copilot" }, name: id,
    capabilities: { temperature: false, reasoning: true, attachment: true, toolcall: true, input: { text: true, audio: false, image: true, video: false, pdf: true }, output: { text: true, audio: false, image: false, video: false, pdf: false }, interleaved: false },
    cost: { input: 1, output: 2, cache: { read: 0, write: 0 } }, limit: { context: 1000, output: 100 }, status: "active", options: { reasoningEffort: "high", custom: "kept" }, headers: { "x-fixture": "kept" }, release_date: "2026-10-07" }
}
function provider(id = "github-copilot"): Provider {
  return { id, name: id, source: "config", env: [], options: {}, models: Object.fromEntries(["gpt-6.1-sol", "gpt-6-luna", "gpt-6-luna-preview"].map(key => [key, model(key, id)])) }
}
// These hooks do not use PluginInput; no host runtime is simulated.
const hooks = await plugin({} as PluginInput)
test("selector accepts only exact provider and target IDs", () => {
  expect([isTarget("github-copilot", "gpt-6.1-sol"), isTarget("github-copilot", "gpt-6-luna"), isTarget("other", "gpt-6-luna"), isTarget("github-copilot", "gpt-6-luna-preview")]).toEqual([true, true, false, false])
})
test("model hook replaces only target npm while preserving endpoint options identity and input", async () => {
  const input = provider()
  const before = structuredClone(input)
  const models = await hooks.provider!.models!(input, {})
  const npm = new URL("../src/sdk.js", import.meta.url).href
  expect(models["gpt-6.1-sol"]).toEqual({ ...before.models["gpt-6.1-sol"]!, api: { ...before.models["gpt-6.1-sol"]!.api, npm } })
  expect(models["gpt-6-luna"]).toEqual({ ...before.models["gpt-6-luna"]!, api: { ...before.models["gpt-6-luna"]!.api, npm } })
  expect(models["gpt-6-luna-preview"]).toBe(input.models["gpt-6-luna-preview"])
  expect(input).toEqual(before)
  expect(await hooks.provider!.models!({ ...input, models }, {})).toEqual(models)
})
test("model hook leaves another provider unchanged", async () => {
  const input = provider("other")
  expect(await hooks.provider!.models!(input, {})).toBe(input.models)
})
test("model hook rejects target stored mode with model-specific credential-free error", async () => {
  const input = provider()
  input.models["gpt-6-luna"]!.options = { store: true, apiKey: "sentinel-secret" }
  await expect(hooks.provider!.models!(input, {})).rejects.toThrow("github-copilot/gpt-6-luna requires store:false; store:true is unsupported")
})
test("model hook rejects provider stored mode inherited by catalog targets", async () => {
  const input = provider()
  input.options.store = true
  await expect(hooks.provider!.models!(input, {})).rejects.toThrow("github-copilot/gpt-6.1-sol requires store:false")
})
test("config hook overrides target model npm only and is repeatable", async () => {
  const config: Config = { provider: { "github-copilot": { npm: "original", options: { custom: "provider" }, models: {
    "gpt-6.1-sol": { options: { reasoningEffort: "max", custom: "kept" }, provider: { npm: "explicit" } },
    "gpt-6-luna": { options: { store: false } }, "gpt-6-luna-preview": { options: { store: true }, provider: { npm: "other" } },
  } }, other: { models: { "gpt-6-luna": { options: { store: true } } } } } }
  const expected = structuredClone(config)
  const npm = new URL("../src/sdk.js", import.meta.url).href
  expected.provider!["github-copilot"]!.models!["gpt-6.1-sol"]!.provider = { npm }
  expected.provider!["github-copilot"]!.models!["gpt-6-luna"]!.provider = { npm }
  await hooks.config!(config)
  expect(config).toEqual(expected)
  await hooks.config!(config)
  expect(config).toEqual(expected)
})
test("config conflict rejects before applying any npm changes", async () => {
  const config: Config = { provider: { "github-copilot": { models: { "gpt-6.1-sol": {}, "gpt-6-luna": { options: { store: true } } } } } }
  const before = structuredClone(config)
  await expect(hooks.config!(config)).rejects.toThrow("github-copilot/gpt-6-luna requires store:false")
  expect(config).toEqual(before)
})
test("provider stored mode is rejected when inherited by a configured target", async () => {
  const config: Config = { provider: { "github-copilot": { options: { store: true }, models: { "gpt-6.1-sol": {} } } } }
  await expect(hooks.config!(config)).rejects.toThrow("store:true")
})
test("target model explicit false supersedes provider stored mode", async () => {
  const config: Config = { provider: { "github-copilot": { options: { store: true }, models: { "gpt-6.1-sol": { options: { store: false } } } } } }
  await hooks.config!(config)
  expect(config.provider!["github-copilot"]!.models!["gpt-6.1-sol"]!.options).toEqual({ store: false })
})
test("configuration aliases do not spoof a non-target API model ID", async () => {
  const config: Config = { provider: { "github-copilot": { models: { "gpt-6-luna": { id: "claude-fixture", provider: { npm: "original" } }, "friendly-luna": { id: "gpt-6-luna", provider: { npm: "original" } } } } } }
  const before = structuredClone(config)
  await hooks.config!(config)
  expect(config).toEqual(before)
})
