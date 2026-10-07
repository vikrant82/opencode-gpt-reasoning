import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"

/** Reject effective stored mode without inspecting/logging credentials; pure and thread-safe. */
export function assertStateless(options: Record<string, unknown>): void {
  if (options.store === true) throw new Error("github-copilot reasoning targets require store:false; store:true is unsupported")
}

type Options = NonNullable<LanguageModelV3CallOptions["providerOptions"]>
function normalize(options: Options | undefined): Options {
  // OpenCode transform.messages remaps providerID onto the SDK namespace,
  // replacing that namespace. Retained adapter metadata is the fallback only.
  const effective = options?.["github-copilot"] ?? options?.copilot ?? {}
  return { ...options, copilot: { ...effective } }
}

/** Copy target inputs without filtering history; rejects stored mode before transport.
 * No shared mutable state; upstream validation/errors remain observable.
 */
export function prepare(options: LanguageModelV3CallOptions): LanguageModelV3CallOptions {
  const providerOptions = normalize(options.providerOptions)
  const effective = providerOptions.copilot!
  assertStateless(effective)
  if (effective.include != null && !Array.isArray(effective.include)) {
    throw new TypeError("github-copilot reasoning include must be an array")
  }
  providerOptions.copilot = {
    ...effective,
    store: false,
    include: [...new Set([...(Array.isArray(effective.include) ? effective.include : []), "reasoning.encrypted_content"])],
  }
  return {
    ...options,
    providerOptions,
    prompt: options.prompt.map(message => ({
      ...message,
      ...(message.providerOptions ? { providerOptions: normalize(message.providerOptions) } : {}),
      content: typeof message.content === "string" ? message.content : message.content.map(part => {
        const providerOptions = normalize(part.providerOptions)
        if (part.type === "reasoning" && providerOptions.copilot?.reasoningEncryptedContent != null) {
          delete providerOptions.copilot.itemId
        }
        return { ...part, providerOptions }
      }),
    })) as LanguageModelV3CallOptions["prompt"],
  }
}
