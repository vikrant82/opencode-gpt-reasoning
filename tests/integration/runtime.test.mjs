import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { installPackage, runtime, stream, completed, stateless, encrypted } from './harness.mjs'

let pkg
before(async () => { pkg = await installPackage() })
after(async () => { await pkg?.close() })

for (const model of ['gpt-6.1-sol', 'gpt-6-luna']) {
  test(`${model}: packaged installed runtime replays earlier user-turn reasoning without IDs`, { timeout: 50000 }, async () => {
    const host = await runtime(pkg, model, (_, count) => stream(model, { reasoning: count === 1 }))
    try {
      const first = await host.run(); completed(first)
      const second = await host.run({ session: first.session }); completed(second)
      assert.equal(second.session, first.session)
      assert.equal(host.requests.length, 2)
      stateless(host.requests[0]); stateless(host.requests[1], true)
    } finally { await host.close() }
  })

  test(`${model}: installed runtime persists added-event encrypted reasoning for the next stateless request`, { timeout: 50000 }, async () => {
    const host = await runtime(pkg, model, (_, count) => stream(model, { reasoning: count === 1, encryptedAt: 'added' }))
    try {
      const first = await host.run(); completed(first)
      assert.deepEqual(await host.reasoningMetadata(first.session, encrypted), [{ encryptedMatches: true }])
      const second = await host.run({ session: first.session }); completed(second)
      assert.equal(second.session, first.session)
      assert.equal(host.requests.length, 2)
      stateless(host.requests[0]); stateless(host.requests[1], true)
    } finally { await host.close() }
  })

  test(`${model}: active read loop preserves reasoning and pairs the real tool result`, { timeout: 30000 }, async () => {
    const host = await runtime(pkg, model, (_, count, fixture) => stream(model, count === 1 ? { reasoning: true, tool: { name: 'read', id: 'synthetic_read_call', args: { filePath: fixture } } } : {}))
    try {
      host.config.permission = { '*': 'deny', read: { '*': 'deny', [path.relative('/', host.fixture)]: 'allow' } }
      await host.saveConfig()
      completed(await host.run())
      assert.equal(host.requests.length, 2)
      stateless(host.requests[1], true)
      assert.deepEqual(host.requests[1].calls, [{ id: 'synthetic_read_call', name: 'read' }])
      assert.equal(host.requests[1].results.length, 1)
      assert.equal(host.requests[1].results[0].id, 'synthetic_read_call')
      assert.equal(host.requests[1].results[0].output.includes('1: SYNTHETIC_READ_RESULT'), true)
    } finally { await host.close() }
  })
}

for (const modelId of ['gpt-6.1-sol', 'gpt-6-luna']) {
for (const conflict of ['configuration', 'variant']) {
  test(`${modelId}: ${conflict} store:true is rejected before model HTTP`, { timeout: 30000 }, async () => {
    const host = await runtime(pkg, modelId, () => stream(modelId))
    try {
      const model = host.config.provider['github-copilot'].models[modelId]
      if (conflict === 'configuration') model.options.store = true
      else model.variants = { conflicting: { store: true } }
      await host.saveConfig()
      const result = await host.run(conflict === 'variant' ? { variant: 'conflicting' } : {})
      assert.equal(result.timedOut, false)
      assert.equal(result.conflict, true)
      assert.equal(host.requests.length, 0)
      assert.equal(result.events.some(event => event.type === 'text'), false)
    } finally { await host.close() }
  })
}
}
