import type { LanguageModelV3 } from "@ai-sdk/provider"
import { createOpenaiCompatible as upstream, type OpenaiCompatibleProviderSettings, type OpenaiCompatibleProvider } from "../vendor/copilot/copilot-provider"
import { prepare } from "./options"
import { isTarget } from "./targets"

/** Stateless target facade over the pinned Copilot implementation.
 * Captured factories prevent recursive dispatch; each call copies inputs and
 * rejects store:true before fetch. Transport and parser errors propagate unchanged.
 * Concurrent calls share no request state. Explicit chat/non-target behavior is upstream.
 */
export function createCopilotReasoning(options: OpenaiCompatibleProviderSettings = {}): OpenaiCompatibleProvider {
  const sdk = upstream(options)
  const responses = sdk.responses
  const languageModel = sdk.languageModel
  const target = (id: string) => isTarget(options.name ?? "github-copilot", id)
  const createResponses = (id: string): LanguageModelV3 => {
    const model = responses(id)
    if (!target(id)) return model
    return {
      specificationVersion: model.specificationVersion,
      provider: model.provider,
      modelId: model.modelId,
      supportedUrls: model.supportedUrls,
      doGenerate: async input => model.doGenerate(prepare(input)),
      doStream: async input => model.doStream(prepare(input)),
    }
  }
  const facade = ((id: string) => target(id) ? createResponses(id) : sdk(id)) as OpenaiCompatibleProvider
  facade.responses = createResponses
  facade.chat = sdk.chat
  facade.languageModel = id => target(id) ? createResponses(id) : languageModel(id)
  return facade
}

// OpenCode discovers the conventional create* provider factory export.
export { createCopilotReasoning as createOpenaiCompatible }
