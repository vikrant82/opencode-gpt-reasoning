import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { assertStateless } from "./options"
import { isTarget } from "./targets"

const npm = new URL("./sdk.js", import.meta.url).href
function check(modelId: string, options: Record<string, unknown> = {}): void {
  try { assertStateless(options) } catch {
    throw new Error(`github-copilot/${modelId} requires store:false; store:true is unsupported`)
  }
}

/** Public target-only hooks; no auth/transport ownership or caller-history changes.
 * Config mutates only target npm selectors as required by the host hook contract.
 * Model hooks return copies; repeated/concurrent invocation is safe. Invalid
 * target stored mode throws a credential-free configuration error.
 */
const plugin: Plugin = async () => ({
  provider: {
    id: "github-copilot",
    async models(provider) {
      if (provider.id !== "github-copilot") return provider.models
      const models = { ...provider.models }
      for (const [id, model] of Object.entries(models)) {
        if (!isTarget(provider.id, id) || !isTarget(model.providerID, model.api.id)) continue
        check(id, { ...provider.options, ...model.options })
        models[id] = { ...model, api: { ...model.api, npm } }
      }
      return models
    },
  },
  async config(config) {
    const provider = config.provider?.["github-copilot"]
    if (!provider) return
    for (const [id, model] of Object.entries(provider.models ?? {})) {
      if (!isTarget("github-copilot", id) || !isTarget("github-copilot", model.id ?? id)) continue
      check(id, { ...provider.options, ...model.options })
    }
    for (const [id, model] of Object.entries(provider.models ?? {})) {
      if (!isTarget("github-copilot", id) || !isTarget("github-copilot", model.id ?? id)) continue
      model.provider = { ...model.provider, npm }
    }
  },
} satisfies Hooks)

export default plugin
