import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, realpath, stat, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { temporary, binary, environment } from '../../scripts/smoke-support.mjs'

const project = fileURLToPath(new URL('../../', import.meta.url))
export const encrypted = 'SYNTHETIC_OFFLINE_REASONING'
const baseEnv = { PATH: environment(temporary).PATH, TMPDIR: temporary }

async function execute(command, args, cwd, env, timeout = 20000) {
  const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin.end()
  let stdout = '', stderr = '', timedOut = false
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeout)
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
    return { code, stdout, stderr, timedOut }
  } finally { clearTimeout(timer) }
}

/** Materialize the actual tarball with production dependencies, outside the checkout.
 * No inherited npm credentials/configuration or package lifecycle scripts are used.
 */
export async function installPackage() {
  await mkdir(temporary, { recursive: true })
  assert.equal((await stat(temporary)).isDirectory(), true)
  const root = await realpath(await mkdtemp(path.join(temporary, 'reasoning-package-')))
  await writeFile(path.join(root, 'user.npmrc'), '')
  await writeFile(path.join(root, 'global.npmrc'), '')
  const env = { ...baseEnv, HOME: root, npm_config_cache: path.join(root, 'cache'), npm_config_userconfig: path.join(root, 'user.npmrc'), npm_config_globalconfig: path.join(root, 'global.npmrc') }
  const version = await execute(binary, ['--version'], root, env)
  assert.equal(version.code, 0)
  assert.equal(version.stdout.trim(), '1.18.35', 'Only the approved installed host may run')
  console.log(`Installed host: ${version.stdout.trim()}; adapter pin: 1.18.34`)
  const dry = await execute('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], project, env)
  assert.equal(dry.code, 0, 'package dry run succeeds')
  const files = JSON.parse(dry.stdout)[0].files.map(file => file.path)
  assert.equal(files.includes('dist/plugin.js'), true)
  assert.equal(files.includes('dist/sdk.js'), true)
  const shippedFile = /^(?:package\.json|LICENSE|README\.md|docs\/(?:compatibility|maintenance)\.md|dist\/.+|vendor\/(?:copilot\/.+|patches\/.+|provenance\.json|LICENSE))$/
  const privateFile = /(?:^|\/)(?:node_modules|\.cache|cache|captures?|fixtures?|tests?|history|archives?|superpowers)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:db|sqlite|sqlite3)(?:[-.]|$)|(?:^|\/)(?:auth|credentials|secrets)(?:[./]|$)/i
  assert.equal(files.every(file => shippedFile.test(file) && !privateFile.test(file)), true, 'tarball contains only approved distribution, docs and vendor provenance')
  for (const file of ['README.md', 'docs/compatibility.md', 'docs/maintenance.md', 'LICENSE', 'vendor/provenance.json', 'vendor/patches/manifest.json']) {
    assert.equal(files.includes(file), true, `tarball retains ${file}`)
  }
  assert.equal(files.some(file => file.startsWith('docs/superpowers/')), false, 'design/plan artifacts are not shipped')
  assert.equal(files.some(file => privateFile.test(file)), false, 'private state and credentials are not shipped')
  const pack = await execute('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], project, env)
  assert.equal(pack.code, 0, 'actual package tarball succeeds')
  await writeFile(path.join(root, 'package.json'), '{"private":true,"type":"module"}')
  const installed = await execute('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', path.join(root, JSON.parse(pack.stdout)[0].filename)], root, env, 60000)
  assert.equal(installed.code, 0, 'production-only public-registry install succeeds')
  const probe = await execute('node', ['--input-type=module', '-e', 'import plugin from "opencode-gpt-reasoning"; import {createCopilotReasoning} from "opencode-gpt-reasoning/sdk"; if(typeof plugin!=="function" || createCopilotReasoning().responses("gpt-6-luna").modelId!=="gpt-6-luna") process.exit(1); console.log(JSON.stringify({plugin:import.meta.resolve("opencode-gpt-reasoning"),sdk:import.meta.resolve("opencode-gpt-reasoning/sdk")}))'], root, env)
  assert.equal(probe.code, 0, 'both public exports resolve with only production dependencies')
  const entries = JSON.parse(probe.stdout)
  assert.equal(await realpath(fileURLToPath(entries.plugin)), path.join(root, 'node_modules/opencode-gpt-reasoning/dist/plugin.js'))
  assert.equal(await realpath(fileURLToPath(entries.sdk)), path.join(root, 'node_modules/opencode-gpt-reasoning/dist/sdk.js'))
  assert.equal((await stat(path.join(root, 'node_modules/@opencode-ai/plugin'))).isDirectory(), true, 'public plugin declaration dependency is installed in production')
  for (const dependency of ['typescript', '@types/bun']) {
    await assert.rejects(stat(path.join(root, 'node_modules', dependency)), { code: 'ENOENT' })
  }
  return { root, plugin: entries.plugin, close: () => rm(root, { recursive: true, force: true }) }
}

/** Synthetic Copilot SSE, including rotated lifecycle IDs; never a runtime/SDK double. */
export function stream(model, { text = 'OFFLINE_DONE', reasoning = false, encryptedPayload = encrypted, encryptedAt = 'done', tool } = {}) {
  const events = [{ type: 'response.created', response: { id: 'response_synthetic', created_at: 1, model } }]
  let index = 0
  if (reasoning) {
    events.push({ type: 'response.output_item.added', output_index: index, item: { type: 'reasoning', id: 'reasoning_start', summary: [], ...(encryptedAt === 'added' || encryptedAt === 'both' ? { encrypted_content: encryptedPayload } : {}) } },
      { type: 'response.output_item.done', output_index: index++, item: { type: 'reasoning', id: 'reasoning_rotated', summary: [], ...(encryptedAt === 'done' || encryptedAt === 'both' ? { encrypted_content: encryptedPayload } : {}) } })
  }
  if (tool) {
    const item = { type: 'function_call', id: 'function_start', call_id: tool.id, name: tool.name, arguments: JSON.stringify(tool.args) }
    events.push({ type: 'response.output_item.added', output_index: index, item: { ...item, arguments: '' } },
      { type: 'response.function_call_arguments.delta', output_index: index, item_id: 'function_rotated', delta: item.arguments },
      { type: 'response.output_item.done', output_index: index, item: { ...item, id: 'function_done_rotated' } })
  } else {
    events.push({ type: 'response.output_item.added', output_index: index, item: { type: 'message', id: 'message_start', role: 'assistant', content: [] } },
      { type: 'response.output_text.delta', output_index: index, content_index: 0, item_id: 'message_rotated', delta: text },
      { type: 'response.output_item.done', output_index: index, item: { type: 'message', id: 'message_done_rotated', role: 'assistant', content: [] } })
  }
  events.push({ type: 'response.completed', response: { id: 'response_synthetic', status: 'completed', usage: { input_tokens: 10, output_tokens: 5 } } })
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
}

/** Fresh isolated runtime; request projections stay in memory, never full-body logs.
 * Each process closes stdin, supplies a title, and is killed after twenty seconds.
 */
export async function runtime(pkg, model, respond, overrides = {}, expectedEncrypted = encrypted) {
  await mkdir(temporary, { recursive: true })
  assert.equal((await stat(temporary)).isDirectory(), true)
  const root = await realpath(await mkdtemp(path.join(temporary, 'reasoning-runtime-')))
  for (const directory of ['home', 'config', 'data', 'cache', 'state', 'work', 'managed']) await mkdir(path.join(root, directory))
  const fixture = path.join(root, 'work/fixture.txt')
  await writeFile(fixture, 'SYNTHETIC_READ_RESULT\n')
  const requests = []
  let backendFailure = false
  const server = createServer(async (request, response) => {
    try {
      let raw = ''; for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw)
      if (request.url !== '/responses' || !['gpt-6.1-sol', 'gpt-6-luna'].includes(body.model) || requests.length >= 6) throw new Error('unexpected transport')
      const record = { model: body.model, store: body.store, effort: body.reasoning?.effort, include: body.include,
        reasoning: body.input.filter(item => item.type === 'reasoning').map(item => ({ noId: !Object.hasOwn(item, 'id'), encryptedMatches: item.encrypted_content === expectedEncrypted, summary: item.summary })),
        calls: body.input.filter(item => item.type === 'function_call').map(item => ({ id: item.call_id, name: item.name })),
        results: body.input.filter(item => item.type === 'function_call_output').map(item => ({ id: item.call_id, output: item.output })) }
      requests.push(record)
      response.writeHead(200, { 'content-type': 'text/event-stream' }).end(respond(record, requests.length, fixture))
    } catch { backendFailure = true; response.writeHead(400).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const config = { plugin: [pkg.plugin], enabled_providers: ['github-copilot'], model: `github-copilot/${model}`, small_model: `github-copilot/${model}`,
    autoupdate: false, share: 'disabled', snapshot: false, permission: 'deny', lsp: false, formatter: false,
    provider: { 'github-copilot': { options: { apiKey: 'synthetic-offline-key', baseURL: `http://127.0.0.1:${server.address().port}` },
      models: Object.fromEntries(['gpt-6.1-sol', 'gpt-6-luna'].map(id => [id, { limit: { context: 100000, output: 1000 }, options: { store: false, reasoningEffort: 'high' } }])) } }, ...overrides }
  await writeFile(path.join(root, 'config.json'), JSON.stringify(config))
  const env = { ...baseEnv, HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'),
    OPENCODE_CONFIG: path.join(root, 'config.json'), OPENCODE_DB: path.join(root, 'test.db'), OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(root, 'managed'),
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1', OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1', OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: '1', OPENCODE_DISABLE_FFF: '1' }
  return { requests, root, fixture, config,
    async run({ session, variant } = {}) {
      const result = await execute(binary, ['run', '--model', `github-copilot/${model}`, '--title', 'synthetic-offline-integration', '--format', 'json', ...(session ? ['--session', session] : []), ...(variant ? ['--variant', variant] : []), 'Synthetic offline task'], path.join(root, 'work'), env)
      const events = result.stdout.trim().split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
      return { code: result.code, timedOut: result.timedOut, events, conflict: (result.stderr + result.stdout).includes('store:true'), session: events.find(event => event.sessionID)?.sessionID }
    },
    async sessions(parent) {
      assert.match(parent, /^ses_[a-zA-Z0-9]+$/)
      const result = await execute('/usr/bin/sqlite3', ['-json', path.join(root, 'test.db'), `SELECT id,parent_id FROM session WHERE id='${parent}' OR parent_id='${parent}'`], root, baseEnv)
      assert.equal(result.code, 0, 'query only this isolated parent and its children')
      return JSON.parse(result.stdout)
    },
    async assistantMessages(session) {
      assert.match(session, /^ses_[a-zA-Z0-9]+$/)
      const result = await execute('/usr/bin/sqlite3', ['-json', path.join(root, 'test.db'), `SELECT json_extract(data,'$.modelID') AS model,json_extract(data,'$.providerID') AS provider,json_extract(data,'$.finish') AS finish FROM message WHERE session_id='${session}' AND json_extract(data,'$.role')='assistant' ORDER BY time_created`], root, baseEnv)
      assert.equal(result.code, 0, 'query assistant outcomes only in this isolated session')
      return JSON.parse(result.stdout)
    },
    async reasoningMetadata(session, expectedPayload) {
      assert.match(session, /^ses_[a-zA-Z0-9]+$/)
      const result = await execute('/usr/bin/sqlite3', ['-json', path.join(root, 'test.db'), `SELECT data FROM part WHERE session_id='${session}' AND json_extract(data,'$.type')='reasoning'`], root, baseEnv)
      assert.equal(result.code, 0, 'query reasoning only in this isolated session')
      return JSON.parse(result.stdout || '[]').map(row => {
        const metadata = JSON.parse(row.data).metadata
        return { encryptedMatches: metadata?.copilot?.reasoningEncryptedContent === expectedPayload }
      })
    },
    async saveConfig() { await writeFile(path.join(root, 'config.json'), JSON.stringify(config)) },
    async close() { await new Promise(resolve => server.close(resolve)); assert.equal(backendFailure, false, 'only bounded target Responses requests'); await rm(root, { recursive: true, force: true }) },
  }
}

export function completed(result, text = 'OFFLINE_DONE') {
  assert.equal(result.timedOut, false)
  assert.equal(result.code, 0)
  assert.equal(result.events.some(event => event.type === 'error'), false)
  assert.equal(result.events.some(event => event.type === 'text' && event.part?.text === text), true)
  assert.equal(result.events.some(event => event.type === 'step_finish' && event.part?.reason === 'stop'), true)
}

export function stateless(record, replay = false) {
  assert.equal(record.store, false)
  assert.equal(record.effort, 'high')
  assert.equal(record.include.includes('reasoning.encrypted_content'), true)
  if (replay) assert.deepEqual(record.reasoning, [{ noId: true, encryptedMatches: true, summary: [] }])
}
