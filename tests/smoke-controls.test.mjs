import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { controls, recordingFetch, summarizeEvidence, parseArgs, permissions, workspace, instrument, runTask, persistedReads, officialAuthPath, withCopilotAuth, runSmoke, runOfflineSmoke, officialOrigin, destination } from '../scripts/smoke-support.mjs'
import { main } from '../scripts/smoke-live.mjs'
import { installPackage, stream } from './integration/harness.mjs'
import { createCopilotReasoning } from '../dist/sdk.js'
import { continuationSkip, readEvidence, persistedPayloads, runTask as boundedTask, prepareHost, installHostDependencies, environment, temporary, binary } from '../scripts/smoke-support.mjs'
import os from 'node:os'

// Prepare once before any cases: one failed bootstrap reports its underlying
// sanitized cause rather than cascading through every host-dependent case.
before(async () => {
  const state = await workspace()
  try { await prepareHost(state) }
  catch (error) { throw new Error('bootstrap-unavailable ' + JSON.stringify(error.diagnostics ?? { stage: 'materialize', exitCode: null, signal: null, timeout: false, npmCode: null })) }
  finally { await rm(state.root, { recursive: true, force: true }) }
})

test('bootstrap failure retains only allowlisted process diagnostics and never retries', async () => {
  const state = await workspace()
  const fixture = path.join(state.root, 'external-npm.cjs')
  try {
    await writeFile(fixture, `require('node:fs').appendFileSync('attempts', '1'); process.stderr.write('npm error code ETIMEDOUT\\nhttps://user:PRIVATE@registry.invalid PRIVATE_SECRET\\n'); process.exit(42)`)
    const attempt = () => installHostDependencies(state, { command: process.execPath, args: [fixture] })
    const check = error => {
      assert.equal(error.message, 'bootstrap-unavailable')
      assert.deepEqual(error.diagnostics, { stage: 'install', exitCode: 42, signal: null, timeout: false, npmCode: 'ETIMEDOUT' })
      assert.equal(JSON.stringify(error).includes('PRIVATE'), false)
      assert.equal(JSON.stringify(error).includes(state.root), false)
      return true
    }
    await assert.rejects(attempt(), check)
    await assert.rejects(attempt(), check)
    assert.equal(await readFile(path.join(state.root, 'config/opencode/attempts'), 'utf8'), '1')
  } finally { await rm(state.root, { recursive: true, force: true }) }
})

test('bootstrap rejects unknown npm codes without exposing stderr', async () => {
  const state = await workspace()
  try {
    await assert.rejects(installHostDependencies(state, { command: process.execPath, args: ['-e', `process.stderr.write('npm error code PRIVATE_CODE\\nPRIVATE_SECRET'); process.exit(7)`, '--'] }), error => {
      assert.deepEqual(error.diagnostics, { stage: 'install', exitCode: 7, signal: null, timeout: false, npmCode: null })
      assert.equal(JSON.stringify(error).includes('PRIVATE'), false)
      return true
    })
  } finally { await rm(state.root, { recursive: true, force: true }) }
})

test('portable isolated environment excludes inherited paths and credentials', () => {
  assert.equal(temporary, path.join(os.tmpdir(), 'opencode-gpt-reasoning'))
  assert.equal(binary, path.join(os.homedir(), '.opencode/bin/opencode'))
  assert.deepEqual(Object.keys(environment('/synthetic')).filter(key => /TOKEN|AUTH|KEY/.test(key)), [])
  assert.equal(environment('/synthetic').PATH, ['/usr/bin', '/bin', '/usr/sbin', '/sbin', path.join(os.homedir(), '.bun/bin'), '/opt/homebrew/bin'].join(path.delimiter))
})

test('bootstrap signal failures expose only the process signal', async () => {
  const state = await workspace()
  try {
    await assert.rejects(installHostDependencies(state, { command: process.execPath, args: ['-e', `process.kill(process.pid, 'SIGTERM')`, '--'] }), error => {
      assert.deepEqual(error.diagnostics, { stage: 'install', exitCode: null, signal: 'SIGTERM', timeout: false, npmCode: null })
      return true
    })
  } finally { await rm(state.root, { recursive: true, force: true }) }
})

test('bootstrap spawn failures omit external error paths', async () => {
  const state = await workspace()
  try {
    await assert.rejects(installHostDependencies(state, { command: path.join(state.root, 'PRIVATE_MISSING'), args: [] }), error => {
      assert.deepEqual(error.diagnostics, { stage: 'spawn', exitCode: null, signal: null, timeout: false, npmCode: null })
      assert.equal(JSON.stringify(error).includes('PRIVATE'), false)
      return true
    })
  } finally { await rm(state.root, { recursive: true, force: true }) }
})

test('bootstrap rejects a successful command without the pinned fixture', async () => {
  const state = await workspace()
  try {
    await assert.rejects(installHostDependencies(state, { command: process.execPath, args: ['-e', 'process.exit(0)', '--'] }), error => {
      assert.deepEqual(error.diagnostics, { stage: 'validate', exitCode: 0, signal: null, timeout: false, npmCode: null })
      return true
    })
  } finally { await rm(state.root, { recursive: true, force: true }) }
})

const body = JSON.stringify({ model: 'gpt-6.1-sol', max_output_tokens: 1000, store: false, reasoning: { effort: 'high' }, include: ['reasoning.encrypted_content'], input: [] })
const url = 'http://127.0.0.1/responses'

test('fifth transport is rejected before fetch across shared factories', async () => {
  let transports = 0
  const budget = controls(() => {})
  const fetcher = async () => { transports++; return new Response('ok') }
  const first = recordingFetch(fetcher, budget), second = recordingFetch(fetcher, budget)
  for (const fetch of [first, second, first, second]) await (await fetch(url, { body })).text()
  await assert.rejects(second(url, { body }), /request-budget/)
  assert.equal(transports, 4)
})

test('concurrent reservations reject request five before transport', async () => {
  let transports = 0
  const fetch = recordingFetch(async () => { transports++; return new Response('ok') }, controls(() => {}))
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => fetch(url, { body })))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 4)
  assert.equal(results[4].reason.message, 'request-budget')
  assert.equal(transports, 4)
})

test('two real compiled public SDK factories share the four inference HTTP budget', async () => {
  let transports = 0
  const budget = controls(() => {})
  const fetch = recordingFetch(async () => { transports++; return new Response(stream('gpt-6.1-sol'), { headers: { 'content-type': 'text/event-stream' } }) }, budget)
  const first = createCopilotReasoning({ baseURL: 'http://127.0.0.1', apiKey: 'synthetic', fetch })
  const second = createCopilotReasoning({ baseURL: 'http://127.0.0.1', apiKey: 'synthetic', fetch })
  const input = { prompt: [{ role: 'user', content: [{ type: 'text', text: 'synthetic' }] }], maxOutputTokens: 1000 }
  for (const sdk of [first, second, first, second]) {
    const result = await sdk.responses('gpt-6.1-sol').doStream(input)
    for await (const part of result.stream) { assert.notEqual(part.type, 'error') }
  }
  await assert.rejects(second.languageModel('gpt-6.1-sol').doStream(input), /request-budget/)
  assert.equal(transports, 4)
})

test('failed evidence sink prevents current and all future transports', async () => {
  let transports = 0
  const fetch = recordingFetch(async () => { transports++; return new Response() }, controls(() => { throw new Error('PRIVATE_ERROR_ID') }))
  await assert.rejects(fetch(url, { body }), /evidence-unavailable/)
  await assert.rejects(fetch(url, { body }), /evidence-unavailable/)
  assert.equal(transports, 0)
})

test('active stream sink failure cancels network and poisons future requests', async () => {
  let cancelled = false, transports = 0
  const budget = controls(record => { if (record.kind === 'reasoning') throw new Error('SECRET') })
  const fetch = recordingFetch(async () => {
    transports++
    return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_item.done","item":{"type":"reasoning","encrypted_content":"SECRET"}}\n\n')) }, cancel() { cancelled = true } }, { highWaterMark: 0 }))
  }, budget)
  await assert.rejects((await fetch(url, { body })).text(), /stream-unavailable/)
  assert.equal(cancelled, true)
  await assert.rejects(fetch(url, { body }), /evidence-unavailable/)
  assert.equal(transports, 1)
})

test('privacy whitelist excludes bodies headers IDs ciphertext text unknown fields and errors', async () => {
  const records = []
  const raw = 'data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"PRIVATE_ID","encrypted_content":"PRIVATE_CIPHER","text":"PRIVATE_TEXT","unknown":"PRIVATE_UNKNOWN"}}\n\ndata: {"type":"error","id":"PRIVATE_ERROR","message":"PRIVATE_ERROR_TEXT"}\n\ndata: {"type":"response.completed","response":{"status":"completed","id":"PRIVATE_RESPONSE"}}\n\n'
  const fetch = recordingFetch(async () => new Response(raw), controls(record => records.push(record)))
  await (await fetch(url, { body: JSON.stringify({ ...JSON.parse(body), unknown: 'PRIVATE_PROMPT', input: [{ type: 'reasoning', encrypted_content: 'PRIVATE_REPLAY' }] }), headers: { authorization: 'PRIVATE_CREDENTIAL' } })).text()
  assert.equal(JSON.stringify(records).includes('PRIVATE'), false)
  assert.deepEqual(records.slice(-3), [{ kind: 'reasoning', requestIndex: 1, encrypted: true, encryptedOutputCount: 0 }, { kind: 'stream-error', requestIndex: 1 }, { kind: 'completion', requestIndex: 1, completed: true }])
})

test('recorder recognizes encrypted reasoning on either legal lifecycle event without exposing ciphertext', async () => {
  for (const [type, expected] of [['response.output_item.added', true], ['response.output_item.done', true], ['response.output_item.added', false]]) {
    const records = []
    const payload = expected ? 'PRIVATE_CIPHER' : undefined
    const raw = `data: ${JSON.stringify({ type, item: { type: 'reasoning', encrypted_content: payload } })}\n\n`
    const fetch = recordingFetch(async () => new Response(raw), controls(record => records.push(record)))
    await (await fetch(url, { body })).text()
    assert.deepEqual(records.filter(record => record.kind === 'reasoning'), [{ kind: 'reasoning', requestIndex: 1, encrypted: expected, encryptedOutputCount: 0 }])
    assert.equal(JSON.stringify(records).includes('PRIVATE_CIPHER'), false)
  }
})

test('public SDK stream records encrypted reasoning at added and done event locations', async () => {
  for (const encryptedAt of ['added', 'done', 'both', 'neither']) {
    const records = []
    const item = event => ({ type: `response.output_item.${event}`, output_index: 0,
      item: { type: 'reasoning', id: `reasoning_${event}`, summary: [],
        ...(encryptedAt === event || encryptedAt === 'both' ? { encrypted_content: 'PRIVATE_CIPHER' } : {}) } })
    const raw = [item('added'), item('done'), { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 10, output_tokens: 2 } } }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
    const fetch = recordingFetch(async () => new Response(raw, { headers: { 'content-type': 'text/event-stream' } }), controls(record => records.push(record)))
    const sdk = createCopilotReasoning({ baseURL: 'http://127.0.0.1', apiKey: 'synthetic', fetch })
    const result = await sdk.responses('gpt-6.1-sol').doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'synthetic' }] }], maxOutputTokens: 1000,
    })
    for await (const part of result.stream) assert.notEqual(part.type, 'error')
    assert.equal(records.filter(record => record.kind === 'reasoning' && record.encrypted).length > 0,
      encryptedAt !== 'neither', encryptedAt)
    assert.equal(JSON.stringify(records).includes('PRIVATE_CIPHER'), false)
  }
})

test('response chunks preserve exact bytes and order including unknown and oversized lines', async () => {
  const chunks = [new Uint8Array([0, 255, 13]), new TextEncoder().encode('data: ' + 'x'.repeat(70000) + '\n'), new TextEncoder().encode('data: {"unknown":"unchanged"}\n\n')]
  let index = 0
  const fetch = recordingFetch(async () => new Response(new ReadableStream({ pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close() } }, { highWaterMark: 0 })), controls(() => {}))
  const reader = (await fetch(url, { body })).body.getReader()
  assert.deepEqual((await reader.read()).value, chunks[0])
  assert.deepEqual((await reader.read()).value, chunks[1])
  assert.deepEqual((await reader.read()).value, chunks[2])
  assert.equal((await reader.read()).done, true)
})

test('non-target model and endpoint never reach transport', async () => {
  let transports = 0
  const fetch = recordingFetch(async () => { transports++; return new Response() }, controls(() => {}))
  await assert.rejects(fetch(url, { body: JSON.stringify({ model: 'gpt-6.1-sol-neighbor' }) }), /invalid-target/)
  await assert.rejects(fetch('http://127.0.0.1/chat/completions', { body }), /invalid-target/)
  assert.equal(transports, 0)
})

test('output beyond 1000 tokens is rejected before transport', async () => {
  let transports = 0
  const fetch = recordingFetch(async () => { transports++; return new Response() }, controls(() => {}))
  await assert.rejects(fetch(url, { body: JSON.stringify({ ...JSON.parse(body), max_output_tokens: 1001 }) }), /output-budget/)
  assert.equal(transports, 0)
})

test('permissions allow exactly two paths relative to actual worktree slash', () => {
  assert.deepEqual(permissions(['/tmp/canonical/work/first.txt', '/tmp/canonical/work/second.txt']), {
    '*': 'deny', read: { '*': 'deny', 'tmp/canonical/work/first.txt': 'allow', 'tmp/canonical/work/second.txt': 'allow' },
  })
})

test('standalone arguments validate before runner and have no implicit fallback', async () => {
  assert.deepEqual(parseArgs(['--model', 'gpt-6-luna']), { model: 'gpt-6-luna', provider: 'github-copilot' })
  for (const args of [[], ['--model', 'other'], ['--model', 'gpt-6.1-sol', '--retry']]) assert.throws(() => parseArgs(args), /invalid-arguments/)
  let invoked = false
  await assert.rejects(main([], async () => { invoked = true }), /invalid-arguments/)
  assert.equal(invoked, false)
  assert.deepEqual(await main(['--model', 'gpt-6.1-sol'], async options => options), { model: 'gpt-6.1-sol' })
})

test('official auth path follows XDG data and HOME defaults without reading files', () => {
  assert.equal(officialAuthPath({ XDG_DATA_HOME: '/synthetic/data' }, '/synthetic/home'), '/synthetic/data/opencode/auth.json')
  assert.equal(officialAuthPath({}, '/synthetic/home'), '/synthetic/home/.local/share/opencode/auth.json')
})

test('synthetic auth extraction keeps only Copilot in memory and original metadata unchanged', async () => {
  const state = await workspace(), file = path.join(state.root, 'synthetic-auth.json')
  const raw = JSON.stringify({ 'github-copilot': { type: 'oauth', refresh: 'PRIVATE_COPILOT', access: '', expires: 0 }, other: { type: 'api', key: 'PRIVATE_OTHER' } })
  try {
    await writeFile(file, raw)
    const result = await withCopilotAuth(file, async content => {
      assert.deepEqual(JSON.parse(content), { 'github-copilot': { type: 'oauth', refresh: 'PRIVATE_COPILOT', access: '', expires: 0 } })
      return { passed: true }
    })
    assert.deepEqual(result, { passed: true })
    assert.equal(await readFile(file, 'utf8'), raw)
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
  } finally { await rm(state.root, { recursive: true, force: true }) }
})

test('synthetic original auth change fails with credential-free category', async () => {
  const state = await workspace(), file = path.join(state.root, 'synthetic-auth.json')
  try {
    await writeFile(file, '{"github-copilot":{"type":"api","key":"PRIVATE"}}')
    await assert.rejects(withCopilotAuth(file, async () => { await writeFile(file, 'changed PRIVATE'); return {} }), { message: 'auth-changed' })
  } finally { await rm(state.root, { recursive: true, force: true }) }
})

test('full runner uses synthetic auth and loopback only and returns no credential or session identifiers', { timeout: 100000 }, async () => {
  const authState = await workspace(), authFile = path.join(authState.root, 'synthetic-auth.json')
  let count = 0
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    JSON.parse(raw)
    count++
    // Relative tool paths exercise the host's real permission resolution.
    response.writeHead(200, { 'content-type': 'text/event-stream' }).end(stream('gpt-6-luna', count <= 2
      ? { reasoning: true, tool: { name: 'read', id: `synthetic_${count}`, args: { filePath: count === 1 ? 'constraints.txt' : 'candidates.csv' } } }
      : { text: 'SELECTION_A_B_SCORE_17_COST_10_CHECKSUM_88' }))
  })
  try {
    await writeFile(authFile, '{"github-copilot":{"type":"api","key":"PRIVATE_SYNTHETIC_AUTH"},"other":{"type":"api","key":"PRIVATE_OTHER"}}')
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const result = await runOfflineSmoke({ model: 'gpt-6-luna', endpoint: `http://127.0.0.1:${server.address().port}` })
    assert.equal(result.taskSuccess, true)
    assert.equal(result.replayAccepted, true)
    assert.equal(result.authUnchanged, true)
    assert.equal(result.inferenceRequests, 3)
    assert.equal(count, 3)
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
    assert.equal(Object.hasOwn(result, 'session'), false)
  } finally { await new Promise(resolve => server.close(resolve)); await rm(authState.root, { recursive: true, force: true }) }
})

test('unapproved OAuth destination is rejected before even opening auth', async () => {
  await assert.rejects(runSmoke({ model: 'gpt-6.1-sol', authFile: '/nonexistent/synthetic-auth.json', providerOptions: { baseURL: 'https://unapproved.invalid' } }), { message: 'unapproved-destination' })
})

test('synthetic OAuth cannot be routed to unapproved origin and enterprise requires approval', async () => {
  const state = await workspace(), authFile = path.join(state.root, 'synthetic-auth.json')
  try {
    const raw = '{"github-copilot":{"type":"oauth","refresh":"PRIVATE_OAUTH","access":"","expires":0,"enterpriseUrl":"synthetic.ghe.com"}}'
    await writeFile(authFile, raw)
    await assert.rejects(runSmoke({ model: 'gpt-6.1-sol', authFile, providerOptions: { baseURL: 'https://unapproved.invalid' } }), { message: 'unapproved-destination' })
    await assert.rejects(runSmoke({ model: 'gpt-6.1-sol', authFile }), { message: 'enterprise-approval-required' })
    assert.equal(await readFile(authFile, 'utf8'), raw)
  } finally { await rm(state.root, { recursive: true, force: true }) }
})

test('authenticated inference guard permits exact official origin and rejects lookalikes before HTTP', async () => {
  let transports = 0, redirect
  const fetch = recordingFetch(async (_, init) => { transports++; redirect = init.redirect; return new Response('ok') }, controls(() => {}), officialOrigin)
  for (const target of ['https://unapproved.invalid/responses', 'https://api.githubcopilot.com.evil.invalid/responses', 'http://api.githubcopilot.com/responses', 'https://user:PRIVATE@api.githubcopilot.com/responses'])
    await assert.rejects(fetch(target, { body, headers: { authorization: 'Bearer PRIVATE_SYNTHETIC_OAUTH' } }), { message: 'unapproved-destination' })
  assert.equal(transports, 0)
  await (await fetch(officialOrigin + '/responses', { body })).text()
  assert.equal(transports, 1)
  assert.equal(redirect, 'error')
  assert.equal(destination(officialOrigin, false, true), officialOrigin)
})

test('installed host selects instrumented public SDK, completes two reads, and replays stateless reasoning', { timeout: 120000 }, async () => {
  const pkg = await installPackage()
  const state = await workspace()
  let count = 0
  const projections = []
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const input = JSON.parse(raw)
    projections.push({ stateless: input.store === false, high: input.reasoning?.effort === 'high', replay: input.input.some(item => item.type === 'reasoning' && item.encrypted_content === 'SYNTHETIC_OFFLINE_REASONING' && !Object.hasOwn(item, 'id')) })
    count++
    response.writeHead(200, { 'content-type': 'text/event-stream' }).end(stream('gpt-6.1-sol', count <= 2
      ? { reasoning: true, tool: { name: 'read', id: `synthetic_${count}`, args: { filePath: state.files[count - 1] } } }
      : { text: 'SELECTION_A_B_SCORE_17_COST_10_CHECKSUM_88' }))
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const plugin = await instrument(state, { plugin: pkg.plugin, sdk: new URL('./sdk.js', pkg.plugin).href })
    const config = { plugin: [plugin], enabled_providers: ['github-copilot'], model: 'github-copilot/gpt-6.1-sol', small_model: 'github-copilot/gpt-6.1-sol',
      autoupdate: false, share: 'disabled', snapshot: false, lsp: false, formatter: false, permission: state.permission,
      provider: { 'github-copilot': { options: { apiKey: 'synthetic-offline-key', baseURL: `http://127.0.0.1:${server.address().port}` }, models: { 'gpt-6.1-sol': { limit: { context: 100000, output: 1000 }, options: { store: false, reasoningEffort: 'high' } } } } } }
    await writeFile(path.join(state.root, 'config.json'), JSON.stringify(config))
    const result = await runTask(state, 'gpt-6.1-sol')
    assert.equal(result.taskSuccess, true)
    assert.equal(result.reads, 2)
        assert.deepEqual(await persistedReads(state, result.session), { first: true, second: true, onlyAllowed: true,
          readAttemptCount: 2, failedReadCount: 0, completedOutsideReadCount: 0, failedOutsideReadCount: 0,
          completedNonReadCount: 0, failedNonReadCount: 0, missingOrUnrecognizedStatusCount: 0 })
    assert.equal(count, 3)
    assert.deepEqual(projections, [{ stateless: true, high: true, replay: false }, { stateless: true, high: true, replay: true }, { stateless: true, high: true, replay: true }])
    const records = (await readFile(path.join(state.root, 'evidence.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    assert.equal(records.some(record => record.kind === 'factory' && record.instrumented), true)
    assert.deepEqual(records.filter(record => record.kind === 'reservation').map(record => record.count), [1, 2, 3])
    assert.equal(JSON.stringify(records).includes('SYNTHETIC'), false)
  } finally { await new Promise(resolve => server.close(resolve)); await rm(state.root, { recursive: true, force: true }); await pkg.close() }
})

test('selection fixture requires combining constraints and candidate rows', async () => {
  const state = await workspace()
  try {
    assert.equal(path.basename(state.files[0]), 'constraints.txt')
    assert.equal(path.basename(state.files[1]), 'candidates.csv')
    assert.match(await readFile(state.files[0], 'utf8'), /exactly two candidates from different teams with total cost <= 10/)
    assert.equal(await readFile(state.files[1], 'utf8'), 'id,team,cost,score\nA,red,4,7\nB,blue,6,10\nC,blue,5,8\nD,red,6,9\nE,green,3,4\n')
    // Independently: A+B costs 10, scores 17, checksum 4*7+6*10=88.
    // C+D exceeds the budget; A+C scores 15; A+D shares a team.
    assert.equal((await readFile(state.files[1], 'utf8')).includes('SELECTION_A_B'), false)
  } finally { await rm(state.root, { recursive: true, force: true }) }
})

test('summary counts distinct output slots and whitelists actual serialized flags', async () => {
  const records = [], budget = controls(record => records.push(record))
  const fetch = recordingFetch(async () => new Response(stream('gpt-6.1-sol', { reasoning: true, encryptedAt: 'both', encryptedPayload: 'PRIVATE_CIPHER' })), budget)
  await (await fetch(url, { body })).text()
  await (await fetch(url, { body: JSON.stringify({ ...JSON.parse(body), reasoning: { effort: 'PRIVATE_EFFORT' }, input: [{ type: 'reasoning', encrypted_content: 'PRIVATE_CIPHER' }] }), headers: { authorization: 'PRIVATE_KEY' } })).text()
  const summary = summarizeEvidence(records)
  assert.deepEqual(summary.actualRequests, [
    { requestIndex: 1, providerMatch: true, model: 'gpt-6.1-sol', modelMatch: true, stateless: true, effort: 'high', outputCap: 1000, encryptedInclude: true, encryptedInputCount: 0, priorOutputMatchCount: 0, noReasoningIds: true, encryptedOutputCount: 1, httpStatus: 200, completed: true },
    { requestIndex: 2, providerMatch: true, model: 'gpt-6.1-sol', modelMatch: true, stateless: true, effort: 'unknown', outputCap: 1000, encryptedInclude: true, encryptedInputCount: 1, priorOutputMatchCount: 1, noReasoningIds: true, encryptedOutputCount: 1, httpStatus: 200, completed: true },
  ])
  assert.equal(summary.highRequested, false)
  assert.equal(JSON.stringify({ records, summary }).includes('PRIVATE'), false)
  assert.equal(summarizeEvidence([]).highRequested, false)
})

for (const model of ['gpt-6.1-sol', 'gpt-6-luna']) {
  for (const encryptedAt of ['added', 'done']) {
    test(`${model} actual host replays ${encryptedAt}-only output after two sequential constrained reads`, { timeout: 100000 }, async () => {
      let count = 0
      const projections = []
      const server = createServer(async (request, response) => {
        let raw = ''; for await (const chunk of request) raw += chunk
        const input = JSON.parse(raw)
        count++
        projections.push({ model: input.model, store: input.store, effort: input.reasoning?.effort,
          cap: input.max_output_tokens, include: input.include.includes('reasoning.encrypted_content'),
          replayMatches: input.input.some(item => item.type === 'reasoning' && item.encrypted_content === 'PRIVATE_RUNTIME_CIPHER' && !Object.hasOwn(item, 'id')),
          successfulReads: input.input.filter(item => item.type === 'function_call_output' && (item.output.includes('1: Candidates: candidates.csv') || item.output.includes('1: id,team,cost,score'))).length })
        response.writeHead(200, { 'content-type': 'text/event-stream' }).end(stream(model, count <= 2
          ? { reasoning: count === 1, encryptedAt, encryptedPayload: 'PRIVATE_RUNTIME_CIPHER', tool: { name: 'read', id: `synthetic_${count}`, args: { filePath: count === 1 ? 'constraints.txt' : 'candidates.csv' } } }
          : { text: 'SELECTION_A_B_SCORE_17_COST_10_CHECKSUM_88' }))
      })
      try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
        const result = await runOfflineSmoke({ model, endpoint: `http://127.0.0.1:${server.address().port}` })
        assert.equal(result.taskSuccess, true)
        assert.deepEqual(result.taskChecks, { processExit: 0, timeout: false, invalidOutput: false, errorReported: false,
          exactAnswerMatch: true, stopFinish: true, completedReadCount: 2, persistedFirstRead: true,
          persistedSecondRead: true, onlyAllowed: true, evidenceAvailable: true, readAttemptCount: 2,
          failedReadCount: 0, completedOutsideReadCount: 0, failedOutsideReadCount: 0,
          completedNonReadCount: 0, failedNonReadCount: 0, missingOrUnrecognizedStatusCount: 0 })
        assert.equal(result.normalFinishClass, 'stop')
        assert.equal(result.replayStatus, 'accepted')
        assert.equal(result.inferenceRequests, 3)
        assert.deepEqual(projections.map(record => record.replayMatches), [false, true, true])
        assert.deepEqual(projections.map(record => record.successfulReads), [0, 1, 2])
        assert.deepEqual(projections.map(({ replayMatches, successfulReads, ...flags }) => flags), Array(3).fill({ model, store: false, effort: 'high', cap: 1000, include: true }))
        assert.deepEqual(result.actualRequests.map(record => [record.requestIndex, record.encryptedOutputCount, record.encryptedInputCount, record.priorOutputMatchCount, record.httpStatus]), [[1, 1, 0, 0, 200], [2, 0, 1, 1, 200], [3, 0, 1, 1, 200]])
        assert.deepEqual(result.actualRequests.map(({ providerMatch, modelMatch, model, stateless, effort, outputCap, encryptedInclude, noReasoningIds, completed }) => ({ providerMatch, modelMatch, model, stateless, effort, outputCap, encryptedInclude, noReasoningIds, completed })),
          Array(3).fill({ providerMatch: true, modelMatch: true, model, stateless: true, effort: 'high', outputCap: 1000, encryptedInclude: true, noReasoningIds: true, completed: true }))
        assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
      } finally { await new Promise(resolve => server.close(resolve)) }
    })
  }
}

for (const mode of ['no-reasoning', 'server-error']) {
  test(`actual host does not claim accepted replay for ${mode}`, { timeout: 100000 }, async () => {
    let count = 0
    const server = createServer(async (request, response) => {
      for await (const chunk of request) { /* Drain only; no body logs. */ }
      count++
      if (mode === 'server-error' && count > 1) { response.writeHead(400, { 'content-type': 'application/json' }).end('{"error":{"message":"PRIVATE_BACKEND_ERROR"}}'); return }
      response.writeHead(200, { 'content-type': 'text/event-stream' }).end(stream('gpt-6.1-sol', count <= 2
        ? { reasoning: mode === 'server-error' && count === 1, tool: { name: 'read', id: `synthetic_${count}`, args: { filePath: count === 1 ? 'constraints.txt' : 'candidates.csv' } } }
        : { reasoning: mode === 'final-only', text: 'SELECTION_A_B_SCORE_17_COST_10_CHECKSUM_88' }))
    })
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const result = await runOfflineSmoke({ model: 'gpt-6.1-sol', endpoint: `http://127.0.0.1:${server.address().port}` })
      assert.equal(result.replayAccepted, false)
      assert.equal(result.replayStatus, 'inconclusive')
      assert.equal(result.taskSuccess, mode !== 'server-error')
      assert.equal(result.returnedReasoning, mode !== 'no-reasoning')
      assert.equal(result.replaySent, mode === 'server-error')
      assert.equal(result.continuationStatus, 'skipped')
      assert.equal(result.continuationSkipReason, mode === 'server-error' ? 'first-task-failed' : 'no-final-reasoning')
      assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
      assert.ok(count <= 4)
    } finally { await new Promise(resolve => server.close(resolve)) }
  })
}

for (const model of ['gpt-6.1-sol', 'gpt-6-luna']) {
  test(`${model} final-only reasoning replays in a fourth same-session user-turn without tools`, { timeout: 100000 }, async () => {
    let count = 0
    const projections = []
    const server = createServer(async (request, response) => {
      let raw = ''; for await (const chunk of request) raw += chunk
      const input = JSON.parse(raw)
      count++
      projections.push({ model: input.model, store: input.store, effort: input.reasoning?.effort, cap: input.max_output_tokens,
        include: input.include.includes('reasoning.encrypted_content'),
        matched: input.input.some(item => item.type === 'reasoning' && item.encrypted_content === 'PRIVATE_FINAL_ONLY' && !Object.hasOwn(item, 'id')),
        reads: input.input.filter(item => item.type === 'function_call_output').length,
        userTurns: input.input.filter(item => item.role === 'user').length })
      response.writeHead(200, { 'content-type': 'text/event-stream' }).end(stream(model, count <= 2
        ? { tool: { name: 'read', id: `synthetic_${count}`, args: { filePath: count === 1 ? 'constraints.txt' : 'candidates.csv' } } }
        : count === 3 ? { reasoning: true, encryptedPayload: 'PRIVATE_FINAL_ONLY', text: 'SELECTION_A_B_SCORE_17_COST_10_CHECKSUM_88' }
          : { text: 'VALID_SELECTION_A_B_SCORE_17_COST_10_CHECKSUM_88' }))
    })
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const result = await runOfflineSmoke({ model, endpoint: `http://127.0.0.1:${server.address().port}` })
      assert.equal(result.firstTaskSuccess, true)
      assert.equal(result.normalCompletion, true)
      assert.equal(result.normalFinishClass, 'stop')
      assert.equal(result.continuationStatus, 'completed')
      assert.equal(result.continuationSuccess, true)
      assert.equal(result.activeLoopReplayAccepted, false)
      assert.equal(result.crossTurnReplayAccepted, true)
      assert.equal(result.replayAccepted, true)
      assert.equal(result.inferenceRequests, 4)
      assert.equal(count, 4)
      assert.deepEqual(projections.map(item => item.matched), [false, false, false, true])
      assert.deepEqual(projections.map(item => item.reads), [0, 1, 2, 2])
      assert.deepEqual(projections.map(item => item.userTurns), [1, 1, 1, 2])
      assert.deepEqual(projections.map(({ matched, reads, userTurns, ...flags }) => flags), Array(4).fill({ model, store: false, effort: 'high', cap: 1000, include: true }))
      assert.deepEqual(result.actualRequests.map(item => [item.requestIndex, item.priorOutputMatchCount, item.encryptedOutputCount, item.httpStatus, item.completed]),
        [[1, 0, 0, 200, true], [2, 0, 0, 200, true], [3, 0, 1, 200, true], [4, 1, 0, 200, true]])
      assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
    } finally { await new Promise(resolve => server.close(resolve)) }
  })
}

test('independent CLI processes cannot reset a shared four-request budget', async () => {
  const state = await workspace(), file = path.join(state.root, 'shared-budget.json')
  try {
    await writeFile(file, '0', { mode: 0o600 })
    const script = `import {controls,recordingFetch} from ${JSON.stringify(new URL('../scripts/smoke-support.mjs', import.meta.url).href)};
      let transported=0;const fetch=recordingFetch(async()=>{transported++;return new Response('ok')},controls(()=>{},{budgetFile:${JSON.stringify(file)}}));
      try{await fetch(${JSON.stringify(url)},{body:${JSON.stringify(body)}});console.log(transported)}catch(e){console.log(e.message+':'+transported)}`
    const execute = promisify(execFile)
    const results = []
    for (let i = 0; i < 5; i++) results.push((await execute(process.execPath, ['--input-type=module', '-e', script], { cwd: state.root })).stdout.trim())
    assert.deepEqual(results, ['1', '1', '1', '1', 'request-budget:0'])
    assert.equal(await readFile(file, 'utf8'), '4')
  } finally { await rm(state.root, { recursive: true, force: true }) }
})

test('first-task wrong answer with final ciphertext never launches continuation', { timeout: 100000 }, async () => {
  let count = 0
  const server = createServer(async (request, response) => {
    for await (const chunk of request) { /* No private body retention. */ }
    count++
    response.writeHead(200, { 'content-type': 'text/event-stream' }).end(stream('gpt-6.1-sol', count <= 2
      ? { tool: { name: 'read', id: `synthetic_${count}`, args: { filePath: count === 1 ? 'constraints.txt' : 'candidates.csv' } } }
      : { reasoning: true, encryptedPayload: 'PRIVATE_FAILED_TASK', text: 'WRONG_SELECTION' }))
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const result = await runOfflineSmoke({ model: 'gpt-6.1-sol', endpoint: `http://127.0.0.1:${server.address().port}` })
    assert.equal(result.firstTaskSuccess, false)
    assert.equal(result.returnedReasoning, true)
    assert.equal(result.continuationStatus, 'skipped')
    assert.equal(result.continuationSkipReason, 'first-task-failed')
    assert.equal(result.crossTurnReplayAccepted, false)
    assert.equal(count, 3)
    assert.deepEqual(result.taskChecks, { processExit: 0, timeout: false, invalidOutput: false, errorReported: false,
      exactAnswerMatch: false, stopFinish: true, completedReadCount: 2, persistedFirstRead: true,
      persistedSecondRead: true, onlyAllowed: true, evidenceAvailable: true, readAttemptCount: 2,
      failedReadCount: 0, completedOutsideReadCount: 0, failedOutsideReadCount: 0,
      completedNonReadCount: 0, failedNonReadCount: 0, missingOrUnrecognizedStatusCount: 0 })
    assert.equal(result.normalFinishClass, 'stop')
    assert.equal(JSON.stringify(result).includes('WRONG_SELECTION'), false)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('continuation gates fail closed at the aggregate deadline and exhausted budget', async () => {
  const base = { taskSuccess: true, requests: [{ completed: true, encryptedOutputCount: 1, httpStatus: 200 }], count: 3, deadline: 100 }
  assert.equal(continuationSkip(base, 99), null)
  assert.equal(continuationSkip(base, 100), 'time-budget')
  assert.equal(continuationSkip({ ...base, count: 4 }, 99), 'request-budget')
  assert.equal(continuationSkip({ ...base, taskSuccess: false }, 99), 'first-task-failed')
  assert.equal(continuationSkip({ ...base, requests: [] }, 99), 'no-final-reasoning')
  assert.equal(continuationSkip({ ...base, requests: [{ completed: false, encryptedOutputCount: 1, httpStatus: 200 }] }, 99), 'no-final-reasoning')
  await assert.rejects(boundedTask({ root: '/nonexistent' }, 'gpt-6.1-sol', undefined, false, { deadline: 0, session: 'ses_synthetic' }), /time-budget/)
  let transports = 0
  const fetch = recordingFetch(async () => { transports++; return new Response() }, controls(() => {}, { deadline: 0 }))
  await assert.rejects(fetch(url, { body }), /time-budget/)
  assert.equal(transports, 0)
})

test('missing evidence reports a sanitized unavailable outcome without hiding malformed evidence', async () => {
  const state = await workspace()
  try {
    const result = await readEvidence(state)
    assert.deepEqual(result, { available: false, records: [] })
    assert.equal(JSON.stringify(result).includes(state.root), false)
    await writeFile(path.join(state.root, 'evidence.jsonl'), 'not-json')
    await assert.rejects(readEvidence(state), SyntaxError)
  } finally { await rm(state.root, { recursive: true, force: true }) }
})

test('unmatched input and streamed errors cannot establish accepted replay', async () => {
  for (const [payload, tail] of [['PRIVATE_OTHER', ''], ['PRIVATE_CIPHER', 'data: {"type":"error","message":"PRIVATE_ERROR"}\n\n']]) {
    const records = [], budget = controls(record => records.push(record))
    let count = 0
    const fetch = recordingFetch(async () => new Response(stream('gpt-6.1-sol', { reasoning: ++count === 1, encryptedPayload: 'PRIVATE_CIPHER' }) + (count === 2 ? tail : '')), budget)
    await (await fetch(url, { body })).text()
    await (await fetch(url, { body: JSON.stringify({ ...JSON.parse(body), input: [{ type: 'reasoning', encrypted_content: payload }] }) })).text()
    const result = summarizeEvidence(records)
    assert.equal(result.replayAccepted, false)
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
  }
})

test('persisted tool diagnostics classify attempts without changing strict read evidence', async () => {
  const state = await workspace()
  try {
    await symlink(state.files[0], path.join(state.root, 'work/alias.txt'))
    const parts = [
      { tool: 'read', status: 'completed', filePath: 'constraints.txt' },
      { tool: 'read', status: 'completed', filePath: 'candidates.csv' },
      { tool: 'read', status: 'error', filePath: '../../outside.txt', error: { name: 'PermissionError', message: 'PRIVATE_ERROR_TEXT' } },
      { tool: 'read', status: 'completed', filePath: '../../outside.txt' },
      { tool: 'read', status: 'completed', filePath: 'alias.txt' },
      { tool: 'read', status: 'error', filePath: 'constraints.txt' },
      { tool: 'read', filePath: 'constraints.txt' },
      { tool: 'other-tool', status: 'completed', filePath: '../../outside.txt', args: { secret: 'PRIVATE_ARGUMENT' } },
      { tool: 'other-tool', status: 'error', filePath: '../../outside.txt' },
    ].map(({ tool, status, filePath, ...extra }) => ({ type: 'tool', tool,
      state: { ...(status ? { status } : {}), input: { filePath }, ...extra } }))
    const sql = `CREATE TABLE part(session_id TEXT,data TEXT);\n${parts.map(part =>
      `INSERT INTO part VALUES ('ses_synthetic','${JSON.stringify(part).replaceAll("'", "''")}');`).join('\n')}`
    execFileSync('/usr/bin/sqlite3', [path.join(state.root, 'test.db')], { input: sql, timeout: 5000, stdio: ['pipe', 'ignore', 'ignore'] })

    const result = await persistedReads(state, 'ses_synthetic')
    assert.deepEqual(result, { first: true, second: true, onlyAllowed: false, readAttemptCount: 7,
      failedReadCount: 2, completedOutsideReadCount: 2, failedOutsideReadCount: 1,
      completedNonReadCount: 1, failedNonReadCount: 1, missingOrUnrecognizedStatusCount: 1 })
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
  } finally { await rm(state.root, { recursive: true, force: true }) }
})

test('replay with reasoning IDs or stored state remains inconclusive', async () => {
  for (const extra of [{ id: 'PRIVATE_ID' }, { stored: true }]) {
    const records = [], budget = controls(record => records.push(record))
    const fetch = recordingFetch(async () => new Response(stream('gpt-6.1-sol', { reasoning: true, encryptedPayload: 'PRIVATE_CIPHER' })), budget)
    await (await fetch(url, { body })).text()
    await (await fetch(url, { body: JSON.stringify({ ...JSON.parse(body), store: extra.stored ? true : false,
      input: [{ type: 'reasoning', encrypted_content: 'PRIVATE_CIPHER', ...(extra.id ? { id: extra.id } : {}) }] }) })).text()
    assert.equal(summarizeEvidence(records).replayAccepted, false)
    assert.equal(JSON.stringify(records).includes('PRIVATE'), false)
  }
})

test('invalid output indexes cannot establish counted prior output identity', async () => {
  for (const output_index of [-1, 1000, 0.5, 'PRIVATE_INDEX']) {
    const records = [], budget = controls(record => records.push(record))
    const raw = `data: ${JSON.stringify({ type: 'response.output_item.done', output_index, item: { type: 'reasoning', encrypted_content: 'PRIVATE_CIPHER' } })}\n\n`
    const fetch = recordingFetch(async () => new Response(raw), budget)
    await (await fetch(url, { body })).text()
    await (await fetch(url, { body: JSON.stringify({ ...JSON.parse(body), input: [{ type: 'reasoning', encrypted_content: 'PRIVATE_CIPHER' }] }) })).text()
    const result = summarizeEvidence(records)
    assert.deepEqual(result.actualRequests.map(record => [record.encryptedOutputCount, record.priorOutputMatchCount]), [[0, 0], [0, 0]])
    assert.equal(result.replayAccepted, false)
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
  }
})

test('actual serialized model mismatch is visible without arbitrary model data', async () => {
  const records = []
  const fetch = recordingFetch(async () => new Response(''), controls(record => records.push(record)), undefined, 'gpt-6-luna')
  await (await fetch(url, { body })).text()
  assert.equal(summarizeEvidence(records).actualRequests[0].modelMatch, false)
  assert.equal(summarizeEvidence(records).actualRequests[0].model, 'gpt-6.1-sol')
})

for (const [name, done, replay, expected] of [
  ['superseded added payload', 'PRIVATE_DONE', 'PRIVATE_ADDED', false],
  ['authoritative done payload', 'PRIVATE_DONE', 'PRIVATE_DONE', true],
  ['omitted done fallback', undefined, 'PRIVATE_ADDED', true],
  ['null done fallback', null, 'PRIVATE_ADDED', true],
  ['empty done invalidation', '', 'PRIVATE_ADDED', false],
]) {
  test(`effective completed reasoning identity handles ${name}`, async () => {
    const records = [], budget = controls(record => records.push(record))
    const events = [
      { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', encrypted_content: 'PRIVATE_ADDED' } },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', encrypted_content: done } },
      { type: 'response.completed', response: { status: 'completed' } },
    ]
    let count = 0
    const fetch = recordingFetch(async () => new Response((++count === 1 ? events : [events[2]]).map(event => `data: ${JSON.stringify(event)}\n\n`).join('')), budget)
    await (await fetch(url, { body })).text()
    await (await fetch(url, { body: JSON.stringify({ ...JSON.parse(body), input: [{ type: 'reasoning', encrypted_content: replay }] }) })).text()
    const summary = summarizeEvidence(records)
    assert.equal(summary.actualRequests[1].priorOutputMatchCount, expected ? 1 : 0)
    assert.equal(summary.replayAccepted, expected)
    assert.equal(summary.actualRequests[0].encryptedOutputCount, done === '' ? 0 : 1)
    assert.equal(JSON.stringify({ records, summary }).includes('PRIVATE'), false)
  })
}

test('superseding one index preserves the same payload from another completed index', async () => {
  const records = [], budget = controls(record => records.push(record))
  const events = [
    { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', encrypted_content: 'PRIVATE_SHARED' } },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', encrypted_content: 'PRIVATE_SHARED' } },
    { type: 'response.output_item.added', output_index: 1, item: { type: 'reasoning', encrypted_content: 'PRIVATE_SHARED' } },
    { type: 'response.output_item.done', output_index: 1, item: { type: 'reasoning', encrypted_content: 'PRIVATE_NEW' } },
    { type: 'response.completed', response: { status: 'completed' } },
  ]
  let count = 0
  const fetch = recordingFetch(async () => new Response((++count === 1 ? events : [events[4]]).map(event => `data: ${JSON.stringify(event)}\n\n`).join('')), budget)
  await (await fetch(url, { body })).text()
  await (await fetch(url, { body: JSON.stringify({ ...JSON.parse(body), input: [{ type: 'reasoning', encrypted_content: 'PRIVATE_SHARED' }] }) })).text()
  const summary = summarizeEvidence(records)
  assert.equal(summary.actualRequests[0].encryptedOutputCount, 2)
  assert.equal(summary.actualRequests[1].priorOutputMatchCount, 1)
  assert.equal(summary.replayAccepted, true)
  assert.equal(JSON.stringify(summary).includes('PRIVATE'), false)
})

test('uncompleted added output never establishes earlier replay identity', async () => {
  const records = [], budget = controls(record => records.push(record))
  const fetch = recordingFetch(async () => new Response('data: {"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","encrypted_content":"PRIVATE_ADDED"}}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n'), budget)
  await (await fetch(url, { body })).text()
  await (await fetch(url, { body: JSON.stringify({ ...JSON.parse(body), input: [{ type: 'reasoning', encrypted_content: 'PRIVATE_ADDED' }] }) })).text()
  assert.equal(summarizeEvidence(records).actualRequests[1].priorOutputMatchCount, 0)
  assert.equal(summarizeEvidence(records).replayAccepted, false)
})

for (const [name, extra, accepted] of [
  ['errored stop', { error: { name: 'APIError', data: { message: 'synthetic failure' } } }, false],
  ['successful stop with missing error', {}, true],
  ['successful stop with null error', { error: null }, true],
  ['unfinished tool loop', { finish: 'tool-calls' }, false],
  ['other model', { modelID: 'gpt-6-luna' }, false],
  ['other provider', { providerID: 'other' }, false],
]) {
  test(`restored cross-process identity accepts only error-free matching stops: ${name}`, async () => {
    const state = await workspace()
    try {
      // Minimal real SQLite projection of the host's message/part persistence seam.
      const message = JSON.stringify({ role: 'assistant', finish: 'stop', modelID: 'gpt-6.1-sol', providerID: 'github-copilot', ...extra })
      const part = JSON.stringify({ type: 'reasoning', metadata: { copilot: { reasoningEncryptedContent: 'PRIVATE_RESTORED' } } })
      execFileSync('/usr/bin/sqlite3', [path.join(state.root, 'test.db')], {
        input: `CREATE TABLE message(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE part(message_id TEXT,data TEXT);
          INSERT INTO message VALUES ('synthetic_message','${message}');
          INSERT INTO part VALUES ('synthetic_message','${part}');`,
        timeout: 5000, stdio: ['pipe', 'ignore', 'ignore'],
      })
      const records = []
      const budget = controls(record => records.push(record), {
        priorPayloads: () => persistedPayloads(state.root, 'gpt-6.1-sol', Date.now() + 5000),
      })
      // The external response completes without reasoning: only restored history can match.
      const fetch = recordingFetch(async () => new Response(stream('gpt-6.1-sol')), budget)
      await (await fetch(url, { body: JSON.stringify({ ...JSON.parse(body), input: [{ type: 'reasoning', encrypted_content: 'PRIVATE_RESTORED' }] }) })).text()
      const summary = summarizeEvidence(records, 0)
      assert.equal(summary.actualRequests[0].priorOutputMatchCount, accepted ? 1 : 0)
      assert.equal(summary.actualRequests[0].encryptedOutputCount, 0)
      assert.equal(summary.crossTurnReplayAccepted, accepted)
      assert.equal(summary.activeLoopReplayAccepted, false)
      assert.equal(JSON.stringify({ records, summary }).includes('PRIVATE'), false)
    } finally { await rm(state.root, { recursive: true, force: true }) }
  })
}
