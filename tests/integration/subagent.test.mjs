import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installPackage, runtime, stream, completed, stateless } from './harness.mjs'

const parentEncrypted = 'SYNTHETIC_PARENT_REASONING_ONLY'
const childEncrypted = 'SYNTHETIC_CHILD_REASONING_ONLY'

test('Sol primary executes the real task tool with a configured Luna child and returns its result', { timeout: 90000 }, async () => {
  const pkg = await installPackage()
  const host = await runtime(pkg, 'gpt-6.1-sol', (record, count) => {
    if (record.model === 'gpt-6-luna') return stream(record.model, { text: 'SYNTHETIC_CHILD_DONE', reasoning: true, encryptedPayload: childEncrypted })
    return stream(record.model, count === 1 ? { reasoning: true, encryptedPayload: parentEncrypted, tool: { name: 'task', id: 'synthetic_task_call', args: {
      description: 'Synthetic child selection check', prompt: 'Return the synthetic child result', subagent_type: 'offline-child',
    } } } : { text: 'SYNTHETIC_PARENT_DONE' })
  }, { agent: { 'offline-child': { mode: 'subagent', model: 'github-copilot/gpt-6-luna', permission: 'deny' } }, permission: { '*': 'deny', task: { '*': 'deny', 'offline-child': 'allow' } } }, parentEncrypted)
  try {
    const result = await host.run(); completed(result, 'SYNTHETIC_PARENT_DONE')
    assert.deepEqual(host.requests.map(record => record.model), ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6.1-sol'])
    for (const record of host.requests) stateless(record)
    assert.deepEqual(host.requests[0].reasoning, [])
    assert.deepEqual(host.requests[1].reasoning, [], 'fresh child must not inherit parent encrypted reasoning')
    stateless(host.requests[2], true)
    assert.deepEqual(host.requests[2].calls, [{ id: 'synthetic_task_call', name: 'task' }])
    assert.equal(host.requests[2].results.length, 1)
    assert.equal(host.requests[2].results[0].id, 'synthetic_task_call')
    assert.equal(host.requests[2].results[0].output.includes('SYNTHETIC_CHILD_DONE'), true)
    assert.equal(host.requests[2].results[0].output.includes(childEncrypted), false, 'task output must not expose child encrypted state')
    assert.equal(host.requests[2].results[0].output.includes(parentEncrypted), false)
    const sessions = await host.sessions(result.session)
    assert.equal(sessions.length, 2)
    assert.equal(sessions.filter(session => session.id === result.session && session.parent_id === null).length, 1)
    assert.equal(sessions.filter(session => session.parent_id === result.session).length, 1)
    const child = sessions.find(session => session.parent_id === result.session)
    assert.deepEqual(await host.reasoningMetadata(child.id, childEncrypted), [{ encryptedMatches: true }])
    assert.equal(host.requests[2].results[0].output.includes(child.id), true)
    assert.deepEqual(await host.assistantMessages(result.session), [
      { model: 'gpt-6.1-sol', provider: 'github-copilot', finish: 'tool-calls' },
      { model: 'gpt-6.1-sol', provider: 'github-copilot', finish: 'stop' },
    ])
    assert.deepEqual(await host.assistantMessages(child.id), [
      { model: 'gpt-6-luna', provider: 'github-copilot', finish: 'stop' },
    ])
  } finally { await host.close(); await pkg.close() }
})
