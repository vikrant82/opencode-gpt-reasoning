import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, writeFile, readFile, stat, rm, cp } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmdirSync } from 'node:fs'

export const models = Object.freeze(['gpt-6.1-sol', 'gpt-6-luna'])
export const temporary = path.join(os.tmpdir(), 'opencode-gpt-reasoning')
export const binary = path.join(os.homedir(), '.opencode/bin/opencode')
export const officialOrigin = 'https://api.githubcopilot.com'
export const taskAnswer = 'SELECTION_A_B_SCORE_17_COST_10_CHECKSUM_88'

/** Smoke destination policy: one exact public official origin, or explicit synthetic
 * loopback mode. No userinfo, query, fragment, alternative ports or redirect follow.
 */
export function destination(value, offline = false, base = false) {
  let url; try { url = new URL(value) } catch { throw new Error('unapproved-destination') }
  const allowed = offline ? url.protocol === 'http:' && url.hostname === '127.0.0.1' && Boolean(url.port) : url.origin === officialOrigin
  if (!allowed || url.username || url.password || url.search || url.hash || (base ? url.pathname !== '/' : url.pathname !== '/responses')) throw new Error('unapproved-destination')
  return url.origin
}

/** Parse without filesystem, authentication, network, or process side effects. */
export function parseArgs(args) {
  if (args.length !== 2 || args[0] !== '--model' || !models.includes(args[1])) throw new Error('invalid-arguments')
  return { model: args[1], provider: 'github-copilot' }
}

/** Exact canonical worktree-relative allows; every other tool/path is denied. */
export function permissions(files) {
  if (files.length !== 2 || files.some(file => !path.isAbsolute(file))) throw new Error('invalid-workspace')
  return { '*': 'deny', read: { '*': 'deny', ...Object.fromEntries(files.map(file => [path.relative('/', file), 'allow'])) } }
}

/** Fresh synthetic state, never copied from a profile or database. */
export async function workspace() {
  await mkdir(temporary, { recursive: true })
  if (!(await stat(temporary)).isDirectory()) throw new Error('workspace-unavailable')
  const root = await realpath(await mkdtemp(path.join(temporary, 'reasoning-smoke-')))
  for (const dir of ['home', 'config', 'data', 'cache', 'state', 'managed', 'work']) await mkdir(path.join(root, dir))
  const files = [path.join(root, 'work/constraints.txt'), path.join(root, 'work/candidates.csv')]
  await writeFile(files[0], 'Candidates: candidates.csv\nSelect exactly two candidates from different teams with total cost <= 10. Maximize total score; break ties by lower total cost, then lexicographically sorted IDs. Checksum = sum(cost * score) for the selected rows. Reply SELECTION_<sorted IDs joined by _>_SCORE_<total score>_COST_<total cost>_CHECKSUM_<checksum>.\n')
  await writeFile(files[1], 'id,team,cost,score\nA,red,4,7\nB,blue,6,10\nC,blue,5,8\nD,red,6,9\nE,green,3,4\n')
  return { root, files, permission: permissions(files) }
}

/** Shared synchronous reservations count each transport attempt, including retries.
 * Sink failures poison future reservations. An optional private numeric file
 * shares reservations across processes; lock contention fails closed, never waits.
 */
export function controls(sink, { budgetFile, deadline = Infinity, priorPayloads = () => [] } = {}) {
  let count = 0, failed = false
  const outputs = new Set()
  const emit = record => {
    if (failed) throw new Error('evidence-unavailable')
    try { sink(Object.freeze(record)) } catch { failed = true; throw new Error('evidence-unavailable') }
  }
  let restored = false
  const checkTime = () => { if (Date.now() >= deadline) throw new Error('time-budget') }
  return { emit, checkTime, remember(payload) { if (outputs.size < 4000) outputs.add(payload) }, matches(payload) {
    if (!restored) {
      restored = true
      try { for (const value of priorPayloads()) if (typeof value === 'string' && value.length > 0 && outputs.size < 4000) outputs.add(value) }
      catch { failed = true; throw new Error('evidence-unavailable') }
    }
    return outputs.has(payload)
  }, reserve() {
    if (failed) throw new Error('evidence-unavailable')
    checkTime()
    if (budgetFile) {
      const lock = budgetFile + '.lock'
      try { mkdirSync(lock, { mode: 0o700 }) } catch { failed = true; throw new Error('evidence-unavailable') }
      try {
        count = JSON.parse(readFileSync(budgetFile, 'utf8'))
        if (!Number.isInteger(count) || count < 0 || count > 4) throw new Error('evidence-unavailable')
        if (count >= 4) throw new Error('request-budget')
        writeFileSync(budgetFile + '.next', JSON.stringify(++count), { mode: 0o600 })
        renameSync(budgetFile + '.next', budgetFile)
      } catch (error) { if (error.message !== 'request-budget') failed = true; throw new Error(error.message === 'request-budget' ? 'request-budget' : 'evidence-unavailable') }
      finally { rmdirSync(lock) }
    } else {
      if (count >= 4) throw new Error('request-budget')
      count++
    }
    emit({ kind: 'reservation', count })
    return count
  } }
}

/** Provider-local transport wrapper: parse in memory, emit only fixed booleans/counts.
 * A single pull-driven reader preserves bytes/order and bounded backpressure. No tee
 * or accumulating raw dump. Active evidence failure cancels and errors the stream.
 */
export function recordingFetch(fetcher, budget, origin, expectedModel) {
  return async (url, init = {}) => {
    if (origin) {
      destination(url, origin !== officialOrigin)
      if (new URL(url).origin !== origin) throw new Error('unapproved-destination')
    }
    let body
    try { body = JSON.parse(init.body) } catch { throw new Error('invalid-request') }
    if (!models.includes(body.model) || new URL(url).pathname !== '/responses') throw new Error('invalid-target')
    if (!Number.isInteger(body.max_output_tokens) || body.max_output_tokens < 1 || body.max_output_tokens > 1000) throw new Error('output-budget')
    const requestIndex = budget.reserve()
    const reasoning = Array.isArray(body.input) ? body.input.filter(item => item.type === 'reasoning') : []
    const encrypted = reasoning.filter(item => typeof item.encrypted_content === 'string' && item.encrypted_content.length > 0)
    budget.emit({ kind: 'request', requestIndex, providerMatch: true, model: body.model, modelMatch: expectedModel ? body.model === expectedModel : models.includes(body.model), target: true, stateless: body.store === false,
      effort: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(body.reasoning?.effort) ? body.reasoning.effort : 'unknown', outputCap: body.max_output_tokens,
      high: body.reasoning?.effort === 'high', encryptedInclude: body.include?.includes('reasoning.encrypted_content') === true,
      encryptedInputCount: Math.min(encrypted.length, 1000), priorOutputMatchCount: Math.min(encrypted.filter(item => budget.matches(item.encrypted_content)).length, 1000),
      replay: encrypted.length > 0,
      noReasoningIds: reasoning.every(item => !Object.hasOwn(item, 'id')) })
    budget.checkTime()
    const response = await fetcher(url, origin ? { ...init, redirect: 'error' } : init)
    try { budget.emit({ kind: 'response', requestIndex, status: response.status, accepted: response.ok }) } catch (error) { await response.body?.cancel(); throw error }
    if (!response.body) return response
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let line = '', discard = false
    const outputSlots = new Set()
    const reasoningSlots = new Map()
    let completed = false, streamFailed = false
    const inspect = bytes => {
      for (const char of decoder.decode(bytes, { stream: true })) {
        if (char === '\n') {
          if (!discard && line.startsWith('data: ')) {
            let event
            try { event = JSON.parse(line.slice(6)) } catch { /* Unknown/non-JSON events are not evidence. */ }
            if (['response.output_item.added', 'response.output_item.done'].includes(event?.type) && event.item?.type === 'reasoning') {
              const slot = Number.isInteger(event.output_index) && event.output_index >= 0 && event.output_index < 1000 ? event.output_index : undefined
              let payload = event.item.encrypted_content
              if (slot !== undefined) {
                const active = reasoningSlots.get(slot)
                if (event.type === 'response.output_item.added') {
                  reasoningSlots.set(slot, { payload, done: false })
                  outputSlots.delete(slot)
                } else {
                  // Match the adapter's nullish DONE precedence, including empty strings.
                  payload = payload ?? active?.payload ?? null
                  reasoningSlots.set(slot, { payload, done: true })
                  if (typeof payload === 'string' && payload.length > 0) outputSlots.add(slot)
                  else outputSlots.delete(slot)
                }
              }
              const encrypted = typeof payload === 'string' && payload.length > 0
              budget.emit({ kind: 'reasoning', requestIndex, encrypted, encryptedOutputCount: outputSlots.size })
            }
            if (['error', 'response.failed'].includes(event?.type)) { streamFailed = true; budget.emit({ kind: 'stream-error', requestIndex }) }
            if (event?.type === 'response.completed') { completed = event.response?.status === 'completed'; budget.emit({ kind: 'completion', requestIndex, completed }) }
          }
          line = ''; discard = false
        } else if (!discard) {
          if (line.length >= 65536) { line = ''; discard = true } else line += char
        }
      }
    }
    return new Response(new ReadableStream({
      async pull(controller) {
        try {
          const result = await reader.read()
           if (result.done) {
             // Only completed, error-free earlier requests establish replay identities.
             if (response.ok && completed && !streamFailed) for (const item of reasoningSlots.values()) {
               if (item.done && typeof item.payload === 'string' && item.payload.length > 0) budget.remember(item.payload)
             }
             controller.close()
           }
          else { inspect(result.value); controller.enqueue(result.value) }
        } catch { await reader.cancel().catch(() => {}); controller.error(new Error('stream-unavailable')) }
      },
      cancel(reason) { return reader.cancel(reason) },
    }, { highWaterMark: 0 }), { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}

/** Strict child environment allowlist; no inherited credentials or profile variables. */
export function environment(root) {
  return { PATH: ['/usr/bin', '/bin', '/usr/sbin', '/sbin', path.join(os.homedir(), '.bun/bin'), '/opt/homebrew/bin'].join(path.delimiter), TMPDIR: temporary,
    HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'),
    XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'), OPENCODE_DB: path.join(root, 'test.db'),
    OPENCODE_CONFIG: path.join(root, 'config.json'), OPENCODE_TEST_MANAGED_CONFIG_DIR: path.join(root, 'managed'),
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_EXTERNAL_SKILLS: '1', OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
    OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: '1', OPENCODE_DISABLE_FFF: '1',
    npm_config_userconfig: path.join(root, 'user.npmrc'), npm_config_globalconfig: path.join(root, 'global.npmrc'),
    npm_config_registry: 'https://registry.npmjs.org', npm_config_cache: path.join(root, 'cache/npm'), npm_config_ignore_scripts: 'true' }
}

/** Prepare the official host dependency before the inference lifecycle. Real npm
 * materializes package, lock and modules once per isolated state, without scripts,
 * inherited credentials or user configuration. Rejected preparations stay rejected;
 * no caller silently retries. Failures expose only sanitized bootstrap fields. */
let preparedDependencies
export async function prepareHost(state) {
  if (state.prepared) return state.prepared
  const started = Date.now()
  state.prepared = (async () => {
    preparedDependencies ??= (async () => {
      const source = await workspace()
      process.once('beforeExit', () => { void rm(source.root, { recursive: true, force: true }) })
      try { await installHostDependencies(source) }
       catch (error) { await rm(source.root, { recursive: true, force: true }); throw error }
      return path.join(source.root, 'config/opencode')
    })()
    try {
      const source = await preparedDependencies
      if (!(await stat(path.join(state.root, 'config'))).isDirectory()) throw new Error('bootstrap-unavailable')
      await cp(source, path.join(state.root, 'config/opencode'), { recursive: true })
      await writeFile(path.join(state.root, 'user.npmrc'), '')
      await writeFile(path.join(state.root, 'global.npmrc'), '')
      return { elapsedMs: Date.now() - started }
    } catch (error) { throw error.message === 'bootstrap-unavailable' && error.diagnostics ? error : bootstrapFailure('materialize') }
  })()
  return state.prepared
}

function bootstrapFailure(stage, exitCode = null, signal = null, timeout = false, npmCode = null) {
  const diagnostics = Object.freeze({ stage, exitCode, signal, timeout, npmCode })
  return Object.assign(new Error('bootstrap-unavailable'), { diagnostics })
}

/** Materialize and validate one pinned fixture. The external command boundary may
 * be supplied by a caller; execution is isolated and bounded to sixty seconds.
 * Errors retain only fixed stages, process outcomes and allowlisted npm codes. */
export async function installHostDependencies(state, { command = process.execPath, args = [path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')] } = {}) {
  if (state.prepared) return state.prepared
  state.prepared = (async () => {
    const dir = path.join(state.root, 'config/opencode')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(state.root, 'user.npmrc'), '')
    await writeFile(path.join(state.root, 'global.npmrc'), '')
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ private: true, dependencies: { '@opencode-ai/plugin': '1.18.35' } }))
    const started = Date.now()
    const child = spawn(command, [...args,
      'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'],
      { cwd: dir, env: environment(state.root), stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = '', timeout = false, exitCode = null, signal = null
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-65536) })
    const timer = setTimeout(() => { timeout = true; child.kill('SIGKILL') }, 60000)
    let stage = 'install'
    try {
      ;[exitCode, signal] = await new Promise((resolve, reject) => { child.once('close', (code, signal) => resolve([code, signal])); child.once('error', () => reject(bootstrapFailure('spawn'))) })
      if (exitCode !== 0) throw new Error('bootstrap-unavailable')
      stage = 'validate'
      const installed = JSON.parse(await readFile(path.join(dir, 'node_modules/@opencode-ai/plugin/package.json'), 'utf8'))
      const lock = JSON.parse(await readFile(path.join(dir, 'package-lock.json'), 'utf8'))
      if (installed.version !== '1.18.35' || lock.packages?.['']?.dependencies?.['@opencode-ai/plugin'] !== '1.18.35') throw new Error('bootstrap-unavailable')
      return { elapsedMs: Date.now() - started }
    } catch (error) {
      if (error.diagnostics) throw error
      const codes = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'E404', 'E401', 'E403', 'EINTEGRITY', 'EACCES', 'ENOSPC'])
      const npmCode = [...stderr.matchAll(/^npm (?:ERR!|error) code ([A-Z0-9_]+)\s*$/gm)].map(match => match[1]).find(code => codes.has(code)) ?? null
      throw bootstrapFailure(stage, Number.isSafeInteger(exitCode) ? exitCode : null, ['SIGKILL', 'SIGTERM', 'SIGABRT', 'SIGINT', 'SIGSEGV'].includes(signal) ? signal : null, timeout, npmCode)
    }
    finally { clearTimeout(timer) }
  })().catch(error => { throw error.diagnostics ? error : bootstrapFailure('materialize') })
  return state.prepared
}

/** Execute only a bounded read task; project output in memory, never log raw output.
 * Lines over 1 MiB fail closed; EOF and the remaining aggregate deadline apply.
 */
export async function runTask(state, model, authContent, official = false, { session, deadline } = {}) {
  if (!models.includes(model)) throw new Error('invalid-target')
  if (deadline !== undefined && Date.now() >= deadline) throw new Error('time-budget')
  if (session && !/^ses_[a-zA-Z0-9]+$/.test(session)) throw new Error('invalid-session')
  await prepareHost(state)
  deadline ??= Date.now() + 90000
  if (Date.now() >= deadline) throw new Error('time-budget')
  const continuing = Boolean(session), previousSession = session
  const child = spawn(binary, ['run', '--model', `github-copilot/${model}`, '--title', 'bounded-reasoning-smoke', '--format', 'json',
    ...(session ? ['--session', session] : []), continuing
      ? 'Recheck the previous selection against the same constraints using retained history, without tools. If valid reply VALID_ followed by the previous answer; otherwise reply INVALID.'
      : 'Read constraints.txt, then the candidates file it names. Solve the selection task using both files and reply exactly in the specified answer format.'],
  { cwd: path.join(state.root, 'work'), env: { ...environment(state.root), ...(official ? { OPENCODE_DISABLE_DEFAULT_PLUGINS: '0' } : {}), ...(authContent ? { OPENCODE_AUTH_CONTENT: authContent } : {}) }, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin.end()
  let pending = '', timedOut = false, invalid = false, text = false, stopped = false, reads = 0, tools = 0, error = false
  child.stderr.on('data', () => {})
  child.stdout.on('data', chunk => {
    pending += chunk.toString()
    if (pending.length > 1048576) { invalid = true; child.kill('SIGKILL'); pending = ''; return }
    const lines = pending.split('\n'); pending = lines.pop()
    for (const line of lines) {
      let event; try { event = JSON.parse(line) } catch { continue }
      if (/^ses_[a-zA-Z0-9]+$/.test(event.sessionID ?? '')) session = event.sessionID
      if (event.type === 'error') error = true
      if (event.type === 'text' && event.part?.text.trim() === (continuing ? 'VALID_' + taskAnswer : taskAnswer)) text = true
      if (event.type === 'step_finish' && event.part?.reason === 'stop') stopped = true
      if (event.type === 'tool_use' && event.part?.tool === 'read' && event.part?.state?.status === 'completed') reads++
      if (event.type === 'tool_use') tools++
    }
  })
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, Math.max(1, deadline - Date.now()))
  try {
    const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', () => reject(new Error('host-unavailable'))) })
     return { taskSuccess: code === 0 && !timedOut && !invalid && !error && text && stopped && (continuing ? tools === 0 && session === previousSession : reads === 2), normalCompletion: code === 0 && !timedOut && !invalid && stopped && !error,
       processExit: Number.isSafeInteger(code) ? code : -1, timeout: timedOut, invalidOutput: invalid, errorReported: error,
       exactAnswerMatch: text, stopFinish: stopped, completedReadCount: reads, reads, session }
  } finally { clearTimeout(timer) }
}

/** Official 1.18.35 Auth uses Global.Path.data/auth.json; Global uses xdg-basedir.
 * Resolve lazily: importing this module does not resolve or read authentication.
 */
export function officialAuthPath(env = process.env, home = os.homedir()) {
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode', 'auth.json')
}

/** Read only into private memory and extract only the official Copilot entry.
 * Metadata checks never rewrite the original. Failures expose fixed categories.
 */
export async function withCopilotAuth(authFile, action) {
  const metadata = async () => {
    const value = await stat(authFile)
    if (!value.isFile() || value.size > 1048576) throw new Error('auth-unavailable')
    return [value.size, value.mtimeMs, value.ino]
  }
  let before, content
  try {
    before = await metadata()
    const entry = JSON.parse(await readFile(authFile, 'utf8'))['github-copilot']
    if (!entry || !['oauth', 'api', 'wellknown'].includes(entry.type)) throw new Error('auth-unavailable')
    content = JSON.stringify({ 'github-copilot': entry })
    if (JSON.stringify(before) !== JSON.stringify(await metadata())) throw new Error('auth-changed')
  } catch (error) { throw new Error(error.message === 'auth-changed' ? 'auth-changed' : 'auth-unavailable') }
  try { return await action(content) } finally {
    content = undefined
    let after; try { after = await metadata() } catch { throw new Error('auth-changed') }
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('auth-changed')
  }
}

/** Explicit operator invocation only; each model session requires prior human approval.
 * Endpoint/options injection supports isolated external transport environments; CLI
 * exposes neither. Credentials are child-only, absent from config/return/evidence.
 */
export async function runSmoke({ model, authFile = officialAuthPath(), entries = {
  plugin: new URL('../dist/plugin.js', import.meta.url).href, sdk: new URL('../dist/sdk.js', import.meta.url).href,
}, providerOptions = {} }) {
  if (!models.includes(model)) throw new Error('invalid-arguments')
  if (Object.keys(providerOptions).some(key => key !== 'baseURL')) throw new Error('unapproved-destination')
  destination(providerOptions.baseURL ?? officialOrigin, false, true)
  return withCopilotAuth(authFile, async content => {
    const auth = JSON.parse(content)['github-copilot']
    if (auth.enterpriseUrl) throw new Error('enterprise-approval-required')
    return runSession({ model, entries, providerOptions: { baseURL: officialOrigin }, content, origin: officialOrigin })
  })
}

/** External synthetic fixture runner: cannot accept real auth or credentials.
 * It never reads any authentication file and only targets explicit IPv4 loopback.
 */
export async function runOfflineSmoke({ model, endpoint, entries = {
  plugin: new URL('../dist/plugin.js', import.meta.url).href, sdk: new URL('../dist/sdk.js', import.meta.url).href,
} }) {
  if (!models.includes(model)) throw new Error('invalid-arguments')
  const origin = destination(endpoint, true, true)
  return runSession({ model, entries, providerOptions: { baseURL: origin, apiKey: 'synthetic-offline-key' }, origin,
    content: JSON.stringify({ 'github-copilot': { type: 'api', key: 'synthetic-offline-key' } }) })
}

async function runSession({ model, entries, providerOptions, content, origin }) {
    const state = await workspace()
    try {
      const preparation = await prepareHost(state)
      const deadline = Date.now() + 90000
      await writeFile(path.join(state.root, 'budget.json'), '0', { mode: 0o600 })
      state.deadline = deadline
      const plugin = await instrument(state, entries, origin, model)
      await writeFile(path.join(state.root, 'config.json'), JSON.stringify({ plugin: [plugin], enabled_providers: ['github-copilot'],
        model: `github-copilot/${model}`, small_model: `github-copilot/${model}`, autoupdate: false, share: 'disabled', snapshot: false,
        permission: state.permission, lsp: false, formatter: false,
        provider: { 'github-copilot': { options: providerOptions, models: { [model]: { limit: { context: 100000, output: 1000 }, options: { store: false, reasoningEffort: 'high' } } } } },
      }))
      const result = await runTask(state, model, content, origin === officialOrigin, { deadline })
        const reads = result.session ? await persistedReads(state, result.session) : { first: false, second: false, onlyAllowed: false,
          readAttemptCount: 0, failedReadCount: 0, completedOutsideReadCount: 0, failedOutsideReadCount: 0,
          completedNonReadCount: 0, failedNonReadCount: 0, missingOrUnrecognizedStatusCount: 0 }
       let evidence = await readEvidence(state)
       let records = evidence.records
       const taskChecks = { processExit: result.processExit, timeout: result.timeout, invalidOutput: result.invalidOutput, errorReported: result.errorReported,
          exactAnswerMatch: result.exactAnswerMatch, stopFinish: result.stopFinish, completedReadCount: result.completedReadCount,
          persistedFirstRead: reads.first === true, persistedSecondRead: reads.second === true,
          onlyAllowed: reads.onlyAllowed === true, evidenceAvailable: evidence.available === true,
          readAttemptCount: reads.readAttemptCount, failedReadCount: reads.failedReadCount,
          completedOutsideReadCount: reads.completedOutsideReadCount, failedOutsideReadCount: reads.failedOutsideReadCount,
          completedNonReadCount: reads.completedNonReadCount, failedNonReadCount: reads.failedNonReadCount,
          missingOrUnrecognizedStatusCount: reads.missingOrUnrecognizedStatusCount }
       const taskSuccess = taskChecks.processExit === 0 && !taskChecks.timeout && !taskChecks.invalidOutput && !taskChecks.errorReported &&
         taskChecks.exactAnswerMatch && taskChecks.stopFinish && taskChecks.completedReadCount === 2 &&
         taskChecks.persistedFirstRead && taskChecks.persistedSecondRead && taskChecks.onlyAllowed && taskChecks.evidenceAvailable
      const firstRequestCount = records.filter(record => record.kind === 'reservation').length
      let skip = continuationSkip({ taskSuccess, requests: summarizeEvidence(records).actualRequests, count: firstRequestCount, deadline })
      let continuation
      if (!skip) {
        try { continuation = await runTask(state, model, content, origin === officialOrigin, { session: result.session, deadline }) }
        catch (error) { if (error.message !== 'time-budget') throw error; skip = 'time-budget' }
        evidence = await readEvidence(state)
        records = evidence.records
      }
        return { taskSuccess, firstTaskSuccess: taskSuccess, taskChecks, normalCompletion: result.normalCompletion,
          normalFinishClass: result.normalCompletion ? 'stop' : 'other',
          continuationStatus: skip ? 'skipped' : continuation.taskSuccess ? 'completed' : 'failed', continuationSkipReason: skip,
          continuationSuccess: continuation?.taskSuccess ?? false,
          preparationElapsedMs: preparation.elapsedMs,
          evidenceStatus: evidence.available ? 'available' : 'evidence-unavailable',
         inferenceRequests: records.filter(record => record.kind === 'reservation').length,
         instrumented: records.some(record => record.kind === 'factory' && record.instrumented),
          ...summarizeEvidence(records, firstRequestCount), authUnchanged: true }
    } finally { await rm(state.root, { recursive: true, force: true }) }
}

/** Missing recorder output is a fixed unavailable outcome, never a leaked path.
 * Other filesystem and malformed-record failures remain errors, not empty proof. */
export async function readEvidence(state) {
  let raw
  try { raw = await readFile(path.join(state.root, 'evidence.jsonl'), 'utf8') }
  catch (error) { if (error.code !== 'ENOENT') throw error; return { available: false, records: [] } }
  return { available: true, records: raw.trim() ? raw.trim().split('\n').map(JSON.parse) : [] }
}

/** Fixed skip categories; failed tasks, absent completed final payload, exhausted
 * reservations and expired aggregate deadline never launch a second prompt. */
export function continuationSkip({ taskSuccess, requests, count, deadline }, now = Date.now()) {
  if (!taskSuccess) return 'first-task-failed'
  if (now >= deadline) return 'time-budget'
  if (count >= 4) return 'request-budget'
  const final = requests.at(-1)
  if (!final?.completed || final.httpStatus < 200 || final.httpStatus >= 300 || !final.encryptedOutputCount) return 'no-final-reasoning'
  return null
}

/** Restore identities privately from this fresh host database, never a diagnostic
 * copy. Only error-free normally stopped same-model assistant output can seed a new process;
 * database failures poison the recorder before transport. */
export function persistedPayloads(root, model, deadline) {
  if (!models.includes(model) || Date.now() >= deadline) throw new Error('evidence-unavailable')
  const sql = `SELECT json_extract(p.data,'$.metadata.copilot.reasoningEncryptedContent') AS payload FROM part p JOIN message m ON p.message_id=m.id WHERE json_extract(p.data,'$.type')='reasoning' AND json_extract(m.data,'$.role')='assistant' AND json_extract(m.data,'$.finish')='stop' AND json_extract(m.data,'$.error') IS NULL AND json_extract(m.data,'$.modelID')='${model}' AND json_extract(m.data,'$.providerID')='github-copilot' LIMIT 4000`
  try {
    const raw = execFileSync('/usr/bin/sqlite3', ['-json', path.join(root, 'test.db'), sql], { timeout: Math.max(1, Math.min(5000, deadline - Date.now())), maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'ignore'], env: environment(root) })
    return JSON.parse(raw.toString() || '[]').map(row => row.payload)
  } catch { throw new Error('evidence-unavailable') }
}

/** Project only recorder-whitelisted fields. Replay requires identical earlier output,
 * no reasoning IDs, stateless storage, successful HTTP and an error-free completion.
 * Payload identity is compared privately by controls; it never enters these records.
 */
export function summarizeEvidence(records, firstRequestCount = Infinity) {
  const requests = records.filter(record => record.kind === 'request').map(record => {
    const related = records.filter(item => item.requestIndex === record.requestIndex)
    return { requestIndex: record.requestIndex, providerMatch: record.providerMatch, model: record.model, modelMatch: record.modelMatch,
      stateless: record.stateless, effort: record.effort, outputCap: record.outputCap, encryptedInclude: record.encryptedInclude,
      encryptedInputCount: record.encryptedInputCount, priorOutputMatchCount: record.priorOutputMatchCount,
      noReasoningIds: record.noReasoningIds, encryptedOutputCount: related.filter(item => item.kind === 'reasoning').at(-1)?.encryptedOutputCount ?? 0,
      httpStatus: related.find(item => item.kind === 'response')?.status ?? 0,
      completed: related.some(item => item.kind === 'completion' && item.completed) && !related.some(item => item.kind === 'stream-error') }
  })
  const replay = requests.filter(record => record.priorOutputMatchCount > 0 && record.noReasoningIds && record.stateless)
  const replayAccepted = replay.some(record => record.httpStatus >= 200 && record.httpStatus < 300 && record.completed)
  const accepted = record => record.httpStatus >= 200 && record.httpStatus < 300 && record.completed
  return { actualRequests: requests, returnedReasoning: requests.some(record => record.encryptedOutputCount > 0), replaySent: replay.length > 0,
    activeLoopReplayAccepted: replay.some(record => record.requestIndex <= firstRequestCount && accepted(record)),
    crossTurnReplayAccepted: replay.some(record => record.requestIndex > firstRequestCount && accepted(record)),
    replayAccepted, replayStatus: replayAccepted ? 'accepted' : 'inconclusive', highRequested: requests.length > 0 && requests.every(record => record.effort === 'high') }
}

/** Query only this synthetic session's tool outcomes; return booleans and aggregate
 * classifications, never part bodies, IDs, prompts, paths, or arbitrary errors.
 * A persisted error status means failed, not denied: only a structured denial code
 * could support that stronger claim. Session IDs and paths remain in memory.
 */
export async function persistedReads(state, session) {
  if (!/^ses_[a-zA-Z0-9]+$/.test(session ?? '')) throw new Error('invalid-session')
  const sql = `SELECT json_extract(data,'$.tool') AS tool,json_extract(data,'$.state.input.filePath') AS file,json_extract(data,'$.state.status') AS status FROM part WHERE session_id='${session}' AND json_extract(data,'$.type')='tool'`
  const child = spawn('/usr/bin/sqlite3', ['-json', path.join(state.root, 'test.db'), sql], { env: environment(state.root), stdio: ['ignore', 'pipe', 'ignore'] })
  let raw = ''
  child.stdout.on('data', chunk => { raw += chunk; if (raw.length > 65536) child.kill('SIGKILL') })
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  try {
    const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', () => reject(new Error('evidence-unavailable'))) })
    if (code !== 0 || raw.length > 65536) throw new Error('evidence-unavailable')
    let rows; try { rows = JSON.parse(raw || '[]') } catch { throw new Error('evidence-unavailable') }
    rows = rows.map(row => ({ ...row, file: typeof row.file === 'string' ? path.resolve(state.root, 'work', row.file) : undefined }))
    const reads = rows.filter(row => row.tool === 'read')
    const knownStatus = row => row.status === 'completed' || row.status === 'error'
    const outside = row => row.file === undefined || !state.files.includes(row.file)
    return { first: reads.some(row => row.file === state.files[0] && row.status === 'completed'),
      second: reads.some(row => row.file === state.files[1] && row.status === 'completed'),
      onlyAllowed: reads.every(row => state.files.includes(row.file)), readAttemptCount: reads.length,
      failedReadCount: reads.filter(row => row.status === 'error').length,
      completedOutsideReadCount: reads.filter(row => row.status === 'completed' && outside(row)).length,
      failedOutsideReadCount: reads.filter(row => row.status === 'error' && outside(row)).length,
      completedNonReadCount: rows.filter(row => row.tool !== 'read' && row.status === 'completed').length,
      failedNonReadCount: rows.filter(row => row.tool !== 'read' && row.status === 'error').length,
      missingOrUnrecognizedStatusCount: rows.filter(row => !knownStatus(row)).length }
  } finally { clearTimeout(timer) }
}

/** Temporary wrapper selects instrumentation in BOTH public hooks, not production.
 * Original Responses captured before aliases; factories and sequential CLI hosts
 * share reservations without storing credential or ciphertext copies.
 */
export async function instrument(state, entries, origin, expectedModel) {
  const support = new URL('./smoke-support.mjs', import.meta.url).href
  const sdk = new URL(`file://${path.join(state.root, 'instrument-sdk.mjs')}`).href
  const shared = state.deadline ? `{budgetFile:${JSON.stringify(path.join(state.root, 'budget.json'))},deadline:${state.deadline},priorPayloads:()=>persistedPayloads(${JSON.stringify(state.root)},${JSON.stringify(expectedModel)},${state.deadline})}` : '{}'
  await writeFile(path.join(state.root, 'instrument-sdk.mjs'), `import {appendFileSync} from 'node:fs';
import {createCopilotReasoning} from ${JSON.stringify(entries.sdk)};
import {controls,recordingFetch,models,persistedPayloads} from ${JSON.stringify(support)};
const budget=controls(record=>appendFileSync(${JSON.stringify(path.join(state.root, 'evidence.jsonl'))},JSON.stringify(record)+'\\n',{mode:0o600}),${shared});
export function createOpenaiCompatible(options={}) {
 budget.emit({kind:'factory',instrumented:true});
 const sdk=createCopilotReasoning({...options,fetch:recordingFetch(options.fetch??globalThis.fetch,budget,${JSON.stringify(origin) ?? 'undefined'},${JSON.stringify(expectedModel) ?? 'undefined'})});
 const responses=sdk.responses;
 const select=id=>{if(!models.includes(id))throw new Error('invalid-target');const m=responses(id);return {...m,doGenerate:i=>m.doGenerate({...i,maxOutputTokens:Math.min(i.maxOutputTokens??1000,1000)}),doStream:i=>m.doStream({...i,maxOutputTokens:Math.min(i.maxOutputTokens??1000,1000)})}};
 const facade=id=>select(id);facade.responses=select;facade.languageModel=select;return facade;
}`)
  const plugin = path.join(state.root, 'instrument-plugin.mjs')
  await writeFile(plugin, `import original from ${JSON.stringify(entries.plugin)};
import {models} from ${JSON.stringify(support)};
const npm=${JSON.stringify(sdk)};
export default async input=>{const hooks=await original(input);return {...hooks,provider:{...hooks.provider,models:async p=>{const records=await hooks.provider.models(p);if(p.id!=='github-copilot')return records;return Object.fromEntries(Object.entries(records).map(([id,m])=>[id,models.includes(id)?{...m,api:{...m.api,npm}}:m]))}},config:async c=>{await hooks.config(c);for(const [id,m] of Object.entries(c.provider?.['github-copilot']?.models??{}))if(models.includes(id))m.provider={...m.provider,npm}}}};
`)
  return new URL(`file://${plugin}`).href
}
