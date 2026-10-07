import { expect, test } from "bun:test"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { createOpenaiCompatible } from "../vendor/copilot/copilot-provider"

const finish = { type: "response.completed", response: { id: "resp_fixture", status: "completed", usage: { input_tokens: 1, output_tokens: 1 } } }
async function stream(events: unknown[], model = "gpt-6.1-sol") {
  const sdk = createOpenaiCompatible({ fetch: Object.assign(async () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } }), { preconnect: globalThis.fetch.preconnect }) })
  const result = await sdk.responses(model).doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "offline fixture" }] }], providerOptions: { copilot: { store: false } } })
  const parts: LanguageModelV3StreamPart[] = []
  for await (const part of result.stream) parts.push(part)
  return parts
}
for (const model of ["gpt-6.1-sol", "gpt-6-luna"]) {
  for (const fixture of [
    { name: "start-only with omitted done field", start: "start-cipher", done: undefined, expected: "start-cipher" },
    { name: "start-only with null done field", start: "start-cipher", done: null, expected: "start-cipher" },
    { name: "done-only", start: undefined, done: "done-cipher", expected: "done-cipher" },
    { name: "different payloads with done precedence", start: "start-cipher", done: "done-cipher", expected: "done-cipher" },
    { name: "neither payload", start: undefined, done: undefined, expected: null },
  ]) {
    test(`${model}: reasoning completion retains ${fixture.name} across rotated IDs`, async () => {
      const parts = await stream([
        { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "rs_start", summary: [], encrypted_content: fixture.start } },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_delta_rotated", output_index: 0, summary_index: 0, delta: "retained summary" },
        { type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: "rs_done_rotated", summary: [], encrypted_content: fixture.done } }, finish,
      ], model)
      expect(parts.filter(part => part.type === "error")).toEqual([])
      expect(parts.filter(part => part.type === "reasoning-delta").map(part => [part.id, part.delta])).toEqual([["rs_start:0", "retained summary"]])
      expect(parts.filter(part => part.type === "reasoning-end").map(part => [part.id, part.providerMetadata?.copilot])).toEqual([
        ["rs_start:0", { itemId: "rs_start", reasoningEncryptedContent: fixture.expected }],
      ])
      expect(parts.at(-1)?.type).toBe("finish")
    })
  }
  test(`${model}: interleaved reasoning retains per-index payloads and clears completed state`, async () => {
    const parts = await stream([
      { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "rs_a", summary: [], encrypted_content: "cipher-a" } },
      { type: "response.output_item.added", output_index: 1, item: { type: "reasoning", id: "rs_b", summary: [], encrypted_content: "cipher-b" } },
      { type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: "rs_a_rotated", summary: [] } },
      { type: "response.output_item.done", output_index: 1, item: { type: "reasoning", id: "rs_b_rotated", summary: [], encrypted_content: null } },
      { type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: "rs_duplicate", summary: [] } },
      { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "rs_fresh", summary: [] } },
      { type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: "rs_fresh_rotated", summary: [] } }, finish,
    ], model)
    expect(parts.filter(part => part.type === "error")).toEqual([])
    expect(parts.filter(part => part.type === "reasoning-end").map(part => [part.id, part.providerMetadata?.copilot?.reasoningEncryptedContent])).toEqual([
      ["rs_a:0", "cipher-a"], ["rs_b:0", "cipher-b"], ["rs_fresh:0", null],
    ])
  })
}
test("rotated text lifecycle IDs emit stable complete text", async () => {
  const parts = await stream([
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_start", role: "assistant", content: [] } },
    { type: "response.output_text.delta", item_id: "msg_rotated1", output_index: 0, content_index: 0, delta: "offline-ok" },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_rotated2", role: "assistant", content: [] } }, finish,
  ])
  expect(parts.filter(part => part.type === "error")).toEqual([])
  expect(parts.filter(part => part.type.startsWith("text-"))).toEqual([
    { type: "text-start", id: "msg_start", providerMetadata: { copilot: { itemId: "msg_start" } } },
    { type: "text-delta", id: "msg_start", delta: "offline-ok" },
    { type: "text-end", id: "msg_start" },
  ])
  expect(parts.at(-1)?.type).toBe("finish")
})
test("rotated reasoning IDs preserve summaries and encrypted replay metadata", async () => {
  const parts = await stream([
    { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "rs_start", summary: [] } },
    { type: "response.reasoning_summary_part.added", item_id: "rs_rotated1", output_index: 0, summary_index: 1, part: { type: "summary_text", text: "" } },
    { type: "response.reasoning_summary_text.delta", item_id: "rs_rotated2", output_index: 0, summary_index: 1, delta: "retained summary" },
    { type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: "rs_rotated3", summary: [], encrypted_content: "synthetic-encrypted" } }, finish,
  ])
  expect(parts.filter(part => part.type === "error")).toEqual([])
  expect(parts.filter(part => part.type === "reasoning-delta")).toEqual([{ type: "reasoning-delta", id: "rs_start:1", delta: "retained summary", providerMetadata: { copilot: { itemId: "rs_start" } } }])
  expect(parts.filter(part => part.type === "reasoning-end").map(part => [part.id, part.providerMetadata?.copilot])).toEqual([
    ["rs_start:0", { itemId: "rs_start", reasoningEncryptedContent: "synthetic-encrypted" }],
    ["rs_start:1", { itemId: "rs_start", reasoningEncryptedContent: "synthetic-encrypted" }],
  ])
  expect(parts.at(-1)?.type).toBe("finish")
})
test("streamed function arguments preserve the external tool call ID", async () => {
  const parts = await stream([
    { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_item", call_id: "call_read", name: "read", arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: "fc_item", output_index: 0, delta: '{"file":"fixture.txt"}' },
    { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc_item", call_id: "call_read", name: "read", arguments: '{"file":"fixture.txt"}' } }, finish,
  ])
  expect(parts.filter(part => part.type === "error")).toEqual([])
  expect(parts.filter(part => part.type === "tool-call").map(part => ({ id: part.toolCallId, name: part.toolName, input: part.input }))).toEqual([{ id: "call_read", name: "read", input: '{"file":"fixture.txt"}' }])
  expect(parts.at(-1)?.type).toBe("finish")
})

test("non-target Chat retains upstream message serialization and generated text", async () => {
  let body: Record<string, unknown> = {}
  const sdk = createOpenaiCompatible({ fetch: Object.assign(async (_: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(init!.body as string)
    return new Response(JSON.stringify({ id: "chat_fixture", created: 1, model: "claude-fixture", choices: [{ index: 0, message: { role: "assistant", content: "chat-ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "content-type": "application/json" } })
  }, { preconnect: globalThis.fetch.preconnect }) })
  const result = await sdk.chat("claude-fixture").doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "fixture question" }] }] })
  expect(body.messages).toEqual([{ role: "user", content: "fixture question" }])
  expect(body.input).toBeUndefined()
  expect(result.content).toEqual([{ type: "text", text: "chat-ok" }])
})
