import { expect, test } from "bun:test"
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import { createCopilotReasoning } from "../src/sdk"

const prompt: LanguageModelV3CallOptions["prompt"] = [{ role: "user", content: [{ type: "text", text: "fixture" }] }]
const completion = { id: "resp_fixture", model: "fixture", created_at: 1, output: [], usage: { input_tokens: 1, output_tokens: 1 } }
function transport() {
  const requests: { body: any; headers: Headers; url: string }[] = []
  const fetch = Object.assign(async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ body: JSON.parse(init!.body as string), headers: new Headers(init!.headers), url: String(url) })
    return new Response(JSON.stringify(completion), { headers: { "content-type": "application/json" } })
  }, { preconnect: globalThis.fetch.preconnect })
  return { requests, sdk: createCopilotReasoning({ name: "github-copilot", baseURL: "https://fixture.invalid", apiKey: "synthetic-key", headers: { "x-fixture": "kept" }, fetch }) }
}
for (const id of ["gpt-6.1-sol", "gpt-6-luna"]) {
  for (const method of ["doGenerate", "doStream"] as const) {
    for (const namespace of ["copilot", "github-copilot"]) {
    test(`${id} ${method} rejects ${namespace} late effective store true without transport`, async () => {
      const { sdk, requests } = transport()
      await expect(sdk.languageModel(id)[method]({ prompt, providerOptions: { [namespace]: { store: true, secret: "not-in-error" } } })).rejects.toThrow("store:true is unsupported")
      expect(requests).toEqual([])
    })
    }
  }
  for (const namespace of ["copilot", "github-copilot"]) {
    test(`${id} accepts ${namespace} with stateless encrypted inclusion and transport options`, async () => {
      const { sdk, requests } = transport()
      await sdk(id).doGenerate({ prompt, providerOptions: { [namespace]: { reasoningEffort: "max", include: ["message.output_text.logprobs", "reasoning.encrypted_content"], metadata: { fixture: "kept" } } } })
      expect(requests[0]!.body).toMatchObject({ model: id, store: false, reasoning: { effort: "max" }, include: ["message.output_text.logprobs", "reasoning.encrypted_content"], metadata: { fixture: "kept" } })
      expect(requests[0]!.url).toBe("https://fixture.invalid/responses")
      expect(requests[0]!.headers.get("authorization")).toBe("Bearer synthetic-key")
      expect(requests[0]!.headers.get("x-fixture")).toBe("kept")
    })
  }
  test(`${id} unspecified effort remains absent`, async () => {
    const { sdk, requests } = transport()
    await sdk.responses(id).doGenerate({ prompt })
    expect(requests[0]!.body.reasoning).toBeUndefined()
    expect(requests[0]!.body.store).toBe(false)
    expect(requests[0]!.body.include).toEqual(["reasoning.encrypted_content"])
  })
}
for (const effort of ["none", "low", "medium", "high", "xhigh", "max"]) {
  test(`bridge preserves requested effort ${effort}`, async () => {
    const { sdk, requests } = transport()
    await sdk.responses("gpt-6-luna").doGenerate({ prompt, providerOptions: { copilot: { reasoningEffort: effort } } })
    expect(requests[0]!.body.reasoning).toEqual({ effort })
  })
}
test("host provider namespace replaces adapter namespace according to OpenCode remapping", async () => {
  const { sdk, requests } = transport()
  await sdk.responses("gpt-6.1-sol").doGenerate({ prompt, providerOptions: { copilot: { reasoningEffort: "low", store: true }, "github-copilot": { reasoningEffort: "high", store: false } } })
  expect(requests[0]!.body.reasoning).toEqual({ effort: "high" })
  expect(requests[0]!.body.store).toBe(false)
})
test("effective host stored mode is not bypassed by stale adapter stateless metadata", async () => {
  const { sdk, requests } = transport()
  await expect(sdk.responses("gpt-6-luna").doGenerate({ prompt, providerOptions: { copilot: { store: false }, "github-copilot": { store: true } } })).rejects.toThrow("store:true")
  expect(requests).toEqual([])
})
test("invalid include is rejected without silently dropping caller options", async () => {
  const { sdk, requests } = transport()
  await expect(sdk.responses("gpt-6-luna").doGenerate({ prompt, providerOptions: { copilot: { include: "invalid" } } })).rejects.toBeInstanceOf(TypeError)
  expect(requests).toEqual([])
})
test("non-target Responses keeps stored mode and does not force encrypted inclusion", async () => {
  const { sdk, requests } = transport()
  await sdk.responses("gpt-6-luna-preview").doGenerate({ prompt, providerOptions: { copilot: { store: true, include: ["file_search_call.results"] } } })
  expect(requests[0]!.body.store).toBe(true)
  expect(requests[0]!.body.include).toEqual(["file_search_call.results"])
  expect(requests[0]!.body.model).toBe("gpt-6-luna-preview")
})
test("upstream transport rejection propagates unchanged without fallback", async () => {
  const failure = new Error("synthetic transport failure")
  const sdk = createCopilotReasoning({ fetch: Object.assign(async () => { throw failure }, { preconnect: globalThis.fetch.preconnect }) })
  await expect(sdk.responses("gpt-6.1-sol").doGenerate({ prompt })).rejects.toBe(failure)
})
test("retained old-turn and active-tool reasoning replay without IDs leaves caller history unchanged", async () => {
  const { sdk, requests } = transport()
  const input: LanguageModelV3CallOptions = { prompt: [
    { role: "assistant", content: [{ type: "reasoning", text: "older summary", providerOptions: { copilot: { itemId: "rs_old", reasoningEncryptedContent: "cipher-old" } } }] },
    { role: "user", content: [{ type: "text", text: "later turn" }] },
    { role: "assistant", content: [
      { type: "reasoning", text: "", providerOptions: { "github-copilot": { itemId: "rs_new", reasoningEncryptedContent: "cipher-new" } } },
      { type: "tool-call", toolCallId: "call_read", toolName: "read", input: { file: "fixture" }, providerOptions: { "github-copilot": { itemId: "fc_kept" } } },
    ] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "call_read", toolName: "read", output: { type: "text", value: "result" } }] },
  ], providerOptions: { "github-copilot": { include: ["file_search_call.results"] } } }
  const before = structuredClone(input)
  await sdk.responses("gpt-6.1-sol").doGenerate(input)
  expect(input).toEqual(before)
  expect(requests[0]!.body.input).toEqual([
    { type: "reasoning", encrypted_content: "cipher-old", summary: [{ type: "summary_text", text: "older summary" }] },
    { role: "user", content: [{ type: "input_text", text: "later turn" }] },
    { type: "reasoning", encrypted_content: "cipher-new", summary: [] },
    { type: "function_call", id: "fc_kept", call_id: "call_read", name: "read", arguments: '{"file":"fixture"}' },
    { type: "function_call_output", call_id: "call_read", output: "result" },
  ])
  expect(requests[0]!.body.include).toEqual(["file_search_call.results", "reasoning.encrypted_content"])
})
test("nonencrypted reasoning retains upstream item ID", async () => {
  const { sdk, requests } = transport()
  await sdk.responses("gpt-6.1-sol").doGenerate({ prompt: [{ role: "assistant", content: [{ type: "reasoning", text: "summary", providerOptions: { copilot: { itemId: "rs_kept" } } }] }] })
  expect(requests[0]!.body.input).toEqual([{ type: "reasoning", id: "rs_kept", summary: [{ type: "summary_text", text: "summary" }] }])
})
test("host reasoning metadata replaces stale adapter metadata without mutating either namespace", async () => {
  const { sdk, requests } = transport()
  const input: LanguageModelV3CallOptions = { prompt: [{ role: "assistant", content: [{ type: "reasoning", text: "summary", providerOptions: {
    copilot: { itemId: "rs_stale", reasoningEncryptedContent: "cipher-stale" },
    "github-copilot": { itemId: "rs_host", reasoningEncryptedContent: "cipher-host" },
  } }] }] }
  const before = structuredClone(input)
  await sdk.responses("gpt-6-luna").doGenerate(input)
  expect(requests[0]!.body.input).toEqual([{ type: "reasoning", encrypted_content: "cipher-host", summary: [{ type: "summary_text", text: "summary" }] }])
  expect(input).toEqual(before)
})
test("explicit target Chat and non-target factory aliases retain upstream Chat dispatch", () => {
  const { sdk } = transport()
  expect(sdk.chat("gpt-6.1-sol").provider).toBe("github-copilot.chat")
  expect(sdk("gpt-6.1-sol-preview").provider).toBe("github-copilot.chat")
  expect(sdk.languageModel("claude-fixture").provider).toBe("github-copilot.chat")
})
for (const factory of ["callable", "languageModel", "responses"] as const) {
  test(`${factory} target factory rejects stored mode without transport`, async () => {
    const { sdk, requests } = transport()
    const model = factory === "callable" ? sdk("gpt-6.1-sol") : sdk[factory]("gpt-6.1-sol")
    await expect(model.doGenerate({ prompt, providerOptions: { copilot: { store: true } } })).rejects.toThrow("store:true")
    expect(requests).toEqual([])
  })
}
test("facade non-target Chat serializes the original messages without bridge options", async () => {
  let body: any
  const sdk = createCopilotReasoning({ fetch: Object.assign(async (_: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(init!.body as string)
    return new Response(JSON.stringify({ id: "chat_fixture", created: 1, model: "claude-fixture", choices: [{ index: 0, message: { role: "assistant", content: "chat-ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "content-type": "application/json" } })
  }, { preconnect: globalThis.fetch.preconnect }) })
  const result = await sdk("claude-fixture").doGenerate({ prompt, providerOptions: { copilot: { store: true } } })
  expect(body.messages).toEqual([{ role: "user", content: "fixture" }])
  expect(body.input).toBeUndefined()
  expect(body.include).toBeUndefined()
  expect(result.content).toEqual([{ type: "text", text: "chat-ok" }])
})
test("same model ID under another provider is not guarded or rewritten", async () => {
  const { requests, sdk } = transport()
  const other = createCopilotReasoning({ name: "other", fetch: Object.assign(async (_: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ body: JSON.parse(init!.body as string), headers: new Headers(), url: "fixture" })
    return new Response(JSON.stringify(completion), { headers: { "content-type": "application/json" } })
  }, { preconnect: globalThis.fetch.preconnect }) })
  await other.responses("gpt-6.1-sol").doGenerate({ prompt, providerOptions: { copilot: { store: true } } })
  expect(requests[0]!.body.store).toBe(true)
  expect(sdk.languageModel("gpt-6-luna").provider).toBe("github-copilot.responses")
})
test("facade rotated SSE retains encrypted Copilot output metadata", async () => {
  const events = [
    { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "rs_start", summary: [] } },
    { type: "response.reasoning_summary_text.delta", item_id: "rs_rotated", output_index: 0, summary_index: 0, delta: "summary" },
    { type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: "rs_end", summary: [], encrypted_content: "cipher-fixture" } },
    { type: "response.output_item.added", output_index: 1, item: { type: "message", id: "msg_start", role: "assistant", content: [] } },
    { type: "response.output_text.delta", item_id: "msg_rotated", output_index: 1, content_index: 0, delta: "done" },
    { type: "response.output_item.done", output_index: 1, item: { type: "message", id: "msg_end", role: "assistant", content: [] } },
    { type: "response.completed", response: { id: "resp_fixture", status: "completed", usage: { input_tokens: 1, output_tokens: 1 } } },
  ]
  const sdk = createCopilotReasoning({ fetch: Object.assign(async () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } }), { preconnect: globalThis.fetch.preconnect }) })
  const { stream } = await sdk("gpt-6-luna").doStream({ prompt })
  const parts = []
  for await (const part of stream) parts.push(part)
  expect(parts.filter(part => part.type === "error")).toEqual([])
  expect(parts.filter(part => part.type === "reasoning-end").map(part => part.providerMetadata)).toEqual([{ copilot: { itemId: "rs_start", reasoningEncryptedContent: "cipher-fixture" } }])
  expect(parts.filter(part => part.type === "text-delta")).toEqual([{ type: "text-delta", id: "msg_start", delta: "done" }])
  expect(parts.at(-1)?.type).toBe("finish")
})
