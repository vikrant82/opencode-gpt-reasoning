import { expect, test } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { convertToOpenAIResponsesInput as convert } from "../vendor/copilot/responses/convert-to-openai-responses-input"
import { createOpenaiCompatible } from "../vendor/copilot/copilot-provider"

const encrypted = "synthetic-encrypted"
function reasoning(options: Record<string, string>, text = ""): LanguageModelV3Prompt {
  return [{ role: "assistant", content: [{ type: "reasoning", text, providerOptions: { copilot: options } }] }]
}
const replay = (options: Record<string, string>, store: boolean, text = "") => convert({ prompt: reasoning(options, text), systemMessageMode: "system", store })

test("missing ID preserves encrypted reasoning with empty summary under store false", async () => {
  expect((await replay({ reasoningEncryptedContent: encrypted }, false)).input).toEqual([{ type: "reasoning", encrypted_content: encrypted, summary: [] }])
})
test("missing ID preserves nonempty reasoning summary under store false", async () => {
  expect((await replay({ reasoningEncryptedContent: encrypted }, false, "retained summary")).input).toEqual([{ type: "reasoning", encrypted_content: encrypted, summary: [{ type: "summary_text", text: "retained summary" }] }])
})
test("ID-present encrypted reasoning retains its upstream inline ID", async () => {
  expect((await replay({ itemId: "rs_saved", reasoningEncryptedContent: encrypted }, false)).input).toEqual([{ type: "reasoning", id: "rs_saved", encrypted_content: encrypted, summary: [] }])
})
test("missing ID without encrypted content remains omitted", async () => {
  expect((await replay({}, false, "summary alone")).input).toEqual([])
})
test("ID-present reasoning without encrypted content retains its upstream summary", async () => {
  expect((await replay({ itemId: "rs_saved" }, false, "summary")).input).toEqual([{ type: "reasoning", id: "rs_saved", encrypted_content: undefined, summary: [{ type: "summary_text", text: "summary" }] }])
})
test("store true keeps the upstream reasoning item reference", async () => {
  expect((await replay({ itemId: "rs_saved", reasoningEncryptedContent: encrypted }, true)).input).toEqual([{ type: "item_reference", id: "rs_saved" }])
})
test("store true does not synthesize a reference for missing ID", async () => {
  expect((await replay({ reasoningEncryptedContent: encrypted }, true)).input).toEqual([])
})
test("tool result retains its matching call ID alongside no-ID replay", async () => {
  const prompt: LanguageModelV3Prompt = [
    { role: "assistant", content: [
      { type: "reasoning", text: "", providerOptions: { copilot: { reasoningEncryptedContent: encrypted } } },
      { type: "tool-call", toolCallId: "call_read", toolName: "read", input: { file: "fixture.txt" } },
    ] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "call_read", toolName: "read", output: { type: "text", value: "fixture content" } }] },
  ]
  expect((await convert({ prompt, systemMessageMode: "system", store: false })).input).toEqual([
    { type: "reasoning", encrypted_content: encrypted, summary: [] },
    { type: "function_call", call_id: "call_read", name: "read", arguments: '{"file":"fixture.txt"}' },
    { type: "function_call_output", call_id: "call_read", output: "fixture content" },
  ])
})

async function request(modelId: string, effort?: string) {
  let body: Record<string, any> = {}
  const sdk = createOpenaiCompatible({ fetch: Object.assign(async (_: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(init!.body as string)
    return new Response(JSON.stringify({ id: "resp_fixture", created_at: 1, model: modelId, output: [], usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { "content-type": "application/json" } })
  }, { preconnect: globalThis.fetch.preconnect }) })
  await sdk.responses(modelId).doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "fixture" }] }], providerOptions: { copilot: { store: false, ...(effort === undefined ? {} : { reasoningEffort: effort }) } } })
  return body
}
for (const model of ["gpt-6.1-sol", "gpt-6-luna"]) {
  for (const effort of ["none", "low", "medium", "high", "xhigh", "max", "synthetic-adapter-string"]) {
    test(`${model} forwards specified effort ${effort} without inventing an enum`, async () => {
      const body = await request(model, effort)
      expect(body.model).toBe(model)
      expect(body.reasoning).toEqual({ effort })
      expect(body.store).toBe(false)
    })
  }
  test(`${model} leaves unspecified effort absent`, async () => {
    expect((await request(model)).reasoning).toBeUndefined()
  })
}
for (const model of ["gpt-6.1-sol-preview", "gpt-6-luna-preview", "gpt-6.1", "gpt-6-other", "gpt-5-chat-latest"]) {
  test(`${model} retains non-reasoning baseline serialization`, async () => {
    const body = await request(model, "high")
    expect(body.model).toBe(model)
    expect(body.reasoning).toBeUndefined()
  })
}
