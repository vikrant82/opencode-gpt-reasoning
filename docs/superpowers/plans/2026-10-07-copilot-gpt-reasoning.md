# Copilot GPT Reasoning Implementation Plan

> **For agentic workers:** Execution: Build-led per design-and-plan-workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package a removable Copilot reasoning-replay plugin for Sol and Luna without rebuilding OpenCode or enabling response storage.

**Architecture:** A target-only OpenCode plugin selects a packaged, pinned Copilot SDK with two narrow patches: stateless no-ID encrypted replay and exact target reasoning classification. A copy-on-write bridge preserves request options and reasoning metadata while retaining upstream streaming and official Copilot authentication.

**Tech Stack:** TypeScript, Bun build/test, Node subprocess/loopback harness, OpenCode plugin API 1.18.34, AI SDK ProviderV3.

**Spec:** `docs/superpowers/specs/2026-10-07-copilot-gpt-reasoning-design.md` — approved 2026-10-07.

## Global Constraints

- Initial targets are exactly `github-copilot/gpt-6.1-sol` and `github-copilot/gpt-6-luna`, including primary and subagent selection.
- Preserve `store:false`; reject explicit target `store:true` before transport, including effective request overrides.
- Preserve supported user-selected effort without introducing a new global effort default. Adapter acceptance is not proof of backend support.
- Preserve reasoning in the supplied retained same-model history; introduce no turn-age filter, pruning, or cross-model restoration.
- Retain official authentication and real Copilot streaming; no generic OpenAI adapter substitution, private host hooks, or global patches.
- Pin the Copilot subtree to OpenCode v1.18.34, immutable tree `aec0b9a6d8898f68f923aaf08b7306d931fd9d76`, with license and per-file hashes.
- Initial prototype-verified host is OpenCode 1.18.34. Human-approved additional integration target is installed OpenCode 1.18.35; keep the vendored adapter pinned to v1.18.34. Other host-version support requires evidence, not an automatic compatibility claim.
- No normal-profile installation, publishing, Git delivery, or implicit live calls. Each live session requires human approval of its bounds.
- Prototype artifacts are reference material, not finished product. Do not import credentials, session databases, or live logs into this project.

## Review Focus

1. Later agent/variant/plugin `store:true` overrides must fail before any transport — Task 3 effective-option tests.
2. An external package must preserve both metadata namespaces without erasing effort or mutating history — Task 2 bridge tests.
3. Model-definition/config merge order must not bypass SDK selection or affect neighboring models — Task 3 hook tests and Task 4 real-loader tests.
4. Luna endpoint/effort differences must not be disguised as Sol compatibility — Task 1 evidence gate and Task 5 separately approved smoke evidence.
5. Diagnostic instrumentation must actually see and bound requests while avoiding content leaks — Task 5 loopback, cap, and sentinel tests.

---

## Workflow metadata

- Route: Design + Plan; subject: Copilot GPT reasoning plugin.
- Direction and written design approved; written plan approved by the human on 2026-10-07.
- Implementation authorized within this plan; Task 1 starting. No completed task may be inferred from prototype results.
- Future delivery intent confirmed: release and publish to npm. Package name/channel and actual release/publication authorization remain separate decisions.
- Design/plan host-version amendment approved 2026-10-07: run Task 4 against installed OpenCode 1.18.35 and record results separately from the 1.18.34 prototype evidence. No compatibility claim until verification passes.
- Design/plan stream-metadata amendment approved 2026-10-07: add a third adapter patch retaining start-event encrypted reasoning when done omits it, with non-null done-event precedence. Implement and review offline regression tests; no live/profile authorization inferred.
- Final independent review required. One initial review and one follow-up after reproduced fixes; a third cycle needs human approval.
- Progress record: append `Task N: complete — <command and observed result>; <changed paths>` only after verification and task/batch review.
- Task 1: complete — `bun test tests/converter.test.ts tests/stream.test.ts`: 33 passed; `bun run scripts/verify-vendor.ts`: 26 pristine hashes/blobs and authorized patches verified; typecheck passed. Changed package foundation, vendor/provenance/patches, converter/stream tests, compatibility baseline. Tasks 1–3 review and follow-up passed.
- Task 2: complete — `bun test tests/plugin.test.ts tests/sdk.test.ts`: combined Tasks 2–3 45 passed; typecheck/build passed. Changed target selector, options bridge, SDK facade and tests. Tasks 1–3 review and follow-up passed.
- Task 3: Ruling: NodeNext declaration imports and missing upstream json-schema types — corrected generated relative module specifiers and added pinned production `@types/json-schema@7.0.15`; scope-preserving fixes to the typed package contract.
- Task 3: complete — `bun run build`, exact NodeNext declaration command, and `bun run test:consumer`: passed (2 consumer tests). Same reviewer independently verified strict NodeNext without Bun types and closed the blocker. Changed plugin, build/export/type configuration, consumer tests and dependency manifests.
- Batch review disposition: one packaging blocker reproduced and fixed; follow-up found no actionable findings. External consumer fixture is not a production-only package installation; that packaging isolation boundary remains for Task 4/6 verification.
- Task 4: Ruling: subagent fixtures initially reused one encrypted sentinel — changed to distinct parent/child payloads and exact outbound/persisted isolation assertions; strengthens approved session isolation without product changes.
- Task 4: complete — `node --test tests/integration/runtime.test.mjs tests/integration/subagent.test.mjs`: 9 passed on installed OpenCode 1.18.35 with adapter v1.18.34; focused post-fix child and old-turn tests passed. Real production-only tarball install, Sol/Luna earlier-turn and successful read-loop replay, configuration/variant guards, and actual Sol-parent/Luna-child execution verified. Changed integration harness/tests and package script. Independent Task 4 review and same-reviewer follow-up passed; isolation finding closed. Production-only declaration-consumer validation remains Task 6.
- Task 5: offline controls verified — `node --test tests/smoke-controls.test.mjs`: 19 passed; syntax checks passed. Actual installed-host Sol/Luna synthetic smoke checks prove instrumented SDK selection, successful reads, replay, four-request reservations, privacy, stream pass-through, and sink-failure containment. Manual CLI/auth loading implemented but never executed with real auth in this product task.
- Task 5: Ruling: reviewer reproduced arbitrary-origin authenticated forwarding and stale operational docs — bound live inference to exact public Copilot origin, reject enterprise/unapproved destinations before auth, separate synthetic IPv4 loopback mode, disable redirects, and correct authorization/cleanup docs. Both in-scope findings closed by same-reviewer follow-up. Live Sol and Luna sessions still await separate human approval; Task 5 is not complete.
- Task 5: Sol live session separately approved and executed once — `node scripts/smoke-live.mjs --model gpt-6.1-sol`: exit 1 because replay criterion was inconclusive. Three instrumented inference requests, requested high effort, both permitted reads succeeded and task completed normally; no encrypted reasoning observed, so no live replay tested. Original auth unchanged and isolated cleanup ran. No retry authorized or performed. Luna live approval remains pending; Task 5 remains incomplete.
- Task 5: Luna live session separately approved and executed once — `node scripts/smoke-live.mjs --model gpt-6-luna`: exit 1 because replay criterion was inconclusive. Three inference requests, two successful permitted reads and normal task completion; no encrypted output, replay, or replay acceptance observed. Original auth unchanged and cleanup ran. No retry performed. Both product live task smoke checks succeeded, but live encrypted-replay gates remain incomplete for both models.
- Task 5: Ruling: start-only encrypted output exposed an upstream v1.18.34 adapter metadata loss — synthetic SDK and installed-host probes for both targets reproduce start capture followed by null completion metadata and lost persistence. Done-only/both-event cases succeed. Human approved a third adapter patch and corresponding design/plan amendment. Offline correction and review pending; prior live streams were not retained, so this finding does not establish their cause.
- Stream-metadata amendment: complete — pre-fix stream regressions 10 passed/6 failed; after one-expression completion fallback, `bun test tests/stream.test.ts tests/converter.test.ts tests/sdk.test.ts`: 80 passed; smoke controls 21 passed; installed-host start-only persistence/replay for both targets 2 passed; build/typecheck/vendor verification passed. Four reproducible replacements in three authorized patch classes, pristine hashes unchanged. Independent scope-bound review found no actionable findings and reran 16 stream tests/vendor verification successfully. Changed vendor completion expression, patch ledger/verifier, stream regressions, and installed-runtime persistence assertions. Product live encrypted replay remains pending; no extra live calls authorized.
- Task 5: post-retention-fix Sol live session separately approved and executed once — `node scripts/smoke-live.mjs --model gpt-6.1-sol`: three instrumented inference requests, task success and normal completion, high effort requested, original auth unchanged. No encrypted output or subsequent replay observed; replay remains inconclusive. CLI summary does not independently expose per-request include/storage/status fields. No retry or Luna execution performed; isolated-state cleanup is implemented in finally. Task 5 remains incomplete.
- Task 5: post-retention-fix Luna live session separately approved and executed once — `node scripts/smoke-live.mjs --model gpt-6-luna`: exit 1 for inconclusive replay; three instrumented requests, successful task and normal completion, high effort requested, original auth unchanged. No encrypted output/replay observed. No retry performed. Stop repeated simple-read trials; both product replay gates remain incomplete despite live task success and passing offline regressions.
- Task 5: improved offline verification complete — constrained two-file selection fixture with independent literal expected result; summary now exposes actual per-request effort/include/storage/status and encrypted input/output/prior-match counts. Real installed-host Sol/Luna added-only and done-only task/replay cases pass. Full controls: 41 passed; syntax checks passed. Reviewer reproduced stale added-event identity acceptance; fixed per-index authoritative completion precedence and publish identities only after successful complete streams. Same-reviewer follow-up passed 10 focused controls and closed finding. No new adapter changes/live calls/profile changes; richer-task live execution awaits separate approval. Task 5 remains incomplete.
- Task 5: richer Sol live session approved and executed once — `node scripts/smoke-live.mjs --model gpt-6.1-sol`: exit 0, normal completion; three actual matching model/provider requests all HTTP 200, effort high, encrypted inclusion true, storage false, output cap 1000. Encrypted output counts [0,0,1], input counts [0,0,0], prior-output match counts [0,0,0]. Reasoning arrived only in the final response, leaving no subsequent request to test replay. Auth unchanged. Exit 0 is not replay acceptance; gate remains inconclusive. No retry or Luna execution.
- Task 5: same-session continuation implemented and reviewed offline — shared atomic numeric budget across CLI processes/factories, aggregate deadline, private restoration from isolated normally stopped same-model history, and separate active-loop/cross-turn metrics. Full controls passed 46/46 before final SQL guard; real Sol/Luna final-only fixtures proved 3+1 requests and cross-turn replay. Bootstrap dependency pre-materialization avoids background host installation; missing evidence produces sanitized failure. Reviewer reproduced restoration from errored stop messages; added error exclusion and six SQLite regressions. Post-fix 14 focused controls and real Sol continuation passed; same-reviewer follow-up independently passed all six new regressions and closed finding. Suite now contains 52 tests; no fresh full-suite claim. No live execution or profile installation included; model-specific live approval remains required.
- Task 5: Sol continuation live separately approved and executed once — `node scripts/smoke-live.mjs --model gpt-6.1-sol`: exit 0; successful first task and continuation, four total instrumented HTTP 200 completed requests, actual high effort/include/storage false/output cap 1000 verified. First-task encrypted outputs [0,0,1]; fourth request encrypted input 1 and prior-output identity match 1, with accepted cross-turn replay and encrypted output 1. Active-loop replay false; aggregate replay accepted. Original auth unchanged; isolated cleanup configured. Temporary dependency preparation 8.215 seconds. No retry/Luna execution; Luna cross-turn live gate still pending.
- Task 5: Luna continuation live separately approved and executed once — `node scripts/smoke-live.mjs --model gpt-6-luna`: exit 1 for first-task failure despite normal stop. Four instrumented HTTP 200 completed requests, actual high effort/include/storage false/output cap 1000. Encrypted input counts [0,1,2,2], prior identity matches [0,1,2,2], encrypted output counts [1,1,0,1]; active-loop replay accepted, aggregate replay accepted, cross-turn replay false. Continuation skipped (`first-task-failed`); original auth unchanged. No retry. Luna backend active-loop replay is established, but full task-success gate remains incomplete; diagnose task failure offline before deciding next verification.
- Task 5: safe task diagnostics added — exposes exact-answer, stop, exit, timeout/error, read-count and persisted-read checks without answer text. Valid/wrong-answer real-runtime and privacy checks passed; expectations unchanged. Earlier Luna state was deleted, so its failed predicate cannot be recovered. No new live call; Luna full-task gate remains pending.
- Task 6: documentation, packaging and final review complete within observed evidence — README, compatibility/maintenance docs, production-only consumer checks and exact package allowlist updated. Bun suite 92 passed (including two consumer tests); combined Node suites 63 passed (52 controls, 11 integration); build, typecheck, vendor verification passed. Final independent review found no actionable findings and independently verified strict production-only NodeNext exports, 26 pristine file hashes, four replacements in three patch classes, focused safeguards and actual subagent isolation. Dry-run package: 63 intended files, no tests, smoke scripts, planning documents or private state. No publication, installation or Git delivery. Overall acceptance remains incomplete solely at documented Task 5 live gates; package stays private 0.0.0 pending separate release decisions.
- Task 5: Luna diagnostic live session separately approved and executed once — `node scripts/smoke-live.mjs --model gpt-6-luna`: exit 1; four matching inference requests, all HTTP 200 and completed, high effort/include/stateless/output cap 1000 verified. Encrypted input counts [0,1,2,3], output counts [1,1,1,1], prior matches [0,1,2,3]; active-loop/aggregate replay accepted. First task: exit 0, no timeout/output/error failure, normal stop, two completed reads, both expected persisted reads true, evidence available; exact-answer and only-allowed predicates false. This establishes predicate failures, not their precise cause or unauthorized access. Continuation skipped (`first-task-failed`); original auth unchanged and cleanup completed. No retry. Full Luna task and cross-turn gates remain pending; next investigation should inspect predicate semantics and preserve privacy-safe attempted/denied-path classifications rather than repeat live runs or weaken expectations.
- Task 5: tool-predicate offline diagnosis and diagnostics complete — exact-path `onlyAllowed` includes failed read attempts, ignores non-read tools, and does not canonicalize aliases. Added status/path-match counts for reads and non-read tools without changing strict success predicates or labeling arbitrary errors as denials. Real SQLite fixture covers failed/completed outside reads, non-read records, missing status and aliases. Focused runs passed 5, 3 and 2 tests with overlap; inventory now 53 controls, not a fresh full-suite result. Independent increment review found no actionable findings and reran the SQLite regression successfully. Earlier Luna predicate cause remains unrecoverable; no additional live calls/profile changes, Task 5 gate remains pending.
- Task 5: complete — final Luna live session separately approved and executed once, `node scripts/smoke-live.mjs --model gpt-6-luna`: exit 0; first task and same-session continuation succeeded. Exactly two allowed reads, no failed/outside/non-read/unknown-status tool records, exact answer matched. Four HTTP 200 completed matching Luna requests, high effort/encrypted inclusion/output cap 1000/stateless flags verified. Encrypted input/output/prior-match counts were [0,0,0], [0,0,0], [0,1,0], [1,1,1] by call: cross-turn and aggregate replay accepted, active-loop false in this run. Earlier Luna runs established active-loop acceptance. Original auth unchanged and isolated cleanup completed. Raw storage-setting field was not independently returned; stateless flag was true. Combined with successful Sol task/cross-turn live evidence and reviewed offline controls, required model acceptance gates are satisfied. No retry/profile installation/publication/Git delivery. Earlier failed Luna task causes remain unknown; no claim they were fixed by diagnostics.
- Pre-delivery preparation approved: sanitized the project path in the design and replaced machine-specific harness paths with standard home/temp resolution. Added bounded bootstrap failure metadata and six external-process regressions without changing timeouts, request limits, adapter behavior or authentication. Targeted checks 4 passed, then final combined Node suite 70 passed (59 controls, 11 integration); syntax, vendor verification, typecheck and build passed. Personal-path/session-ID scan clean except explicitly synthetic fixture IDs. Earlier 42-pass/11-failure run discarded bootstrap diagnostics, so its initiating cause remains unresolved; cold-fetch timeout is a hypothesis, not a demonstrated defect. No Git initialization, push or publication performed during preparation.
- Deviations within the approved design: record `Task N: Ruling: <finding> — <decision and rationale>`.
- Material design changes require renewed written design and affected plan approval.

## File responsibilities

- `vendor/copilot/`: pinned upstream adapter with documented local patches.
- `vendor/provenance.json`, `vendor/patches/`: immutable origin, hashes, and reproducible patch records.
- `src/targets.ts`: exact provider/model selection.
- `src/options.ts`: stateless option validation and copy-on-write namespace bridge.
- `src/sdk.ts`: public Copilot factory facade and per-call guard.
- `src/plugin.ts`: public model/config hooks and exported plugin.
- `tests/`: offline behavioral and hook contracts.
- `tests/integration/`: installed-runtime loopback and subagent checks.
- `scripts/`: vendoring verification, builds, and opt-in smoke controls.
- `docs/compatibility.md`: evidence-backed model/host capability matrix.
- `README.md`: usage, removal, limitations, maintenance, and privacy.

### Task 1: Reproducible adapter foundation and capability baseline

**Files:** Create `package.json`, lockfile, `tsconfig.json`, `.gitignore`, `LICENSE`, `vendor/copilot/**`, `vendor/provenance.json`, `vendor/patches/**`, `scripts/verify-vendor.ts`, `docs/compatibility.md`, `tests/converter.test.ts`, `tests/stream.test.ts`.

**Interfaces:** Produces vendored `createOpenaiCompatible(options)` retaining upstream ProviderV3 callable factory and `responses`, `chat`, and `languageModel` methods. Dependencies pinned to `@ai-sdk/provider@3.0.16`, `@ai-sdk/provider-utils@4.0.51`, `zod@4.1.8`; plugin development types pinned to `@opencode-ai/plugin@1.18.34`.

- [ ] Copy only the self-contained v1.18.34 Copilot adapter and license; verify immutable provenance, pristine hashes, and required imports. No repository initialization or delivery steps.
- [ ] Apply the no-ID encrypted reasoning fallback only under `store:false`, preserving summaries and omitting absent IDs. Add exact reasoning classification for `gpt-6.1-sol` and `gpt-6-luna`; leave other IDs unchanged.
- [ ] Record model/API evidence. Inspect public catalog and official capability material without credentials. Mark unavailable Luna endpoint/effort facts as unverified; do not infer backend support from the adapter's `z.string()` effort schema. A conflicting endpoint or required broader patch stops execution for design renewal.
- [ ] Add converter tests for empty/nonempty summary replay, ID-present replay, absent encrypted data, unchanged `store:true` branch, exact classification, neighboring non-target IDs, unspecified effort, and passthrough of effort strings without a newly invented enum.
- [ ] Add real adapter SSE fixtures covering rotated text/reasoning IDs and tool calls, checking emitted content and metadata rather than internal calls.
- [ ] Approved amendment: retain per-item encrypted content through completion when the done event omits it; prefer non-null done content and preserve cleanup. Update reversible patch provenance and verify start-only/done-only/neither/differing-payload cases through the real SDK, plus start-only installed-host persistence/replay for both targets. Preserve failing contract expectations until corrected. Review this increment before any live follow-up.
- [ ] Run `bun test tests/converter.test.ts tests/stream.test.ts` and `bun run scripts/verify-vendor.ts`. Expected: all tests pass; upstream origin and patch manifest match; only the two authorized patch classes alter adapter behavior. Report checkpoint.

### Task 2: Stateless SDK facade and metadata bridge

**Files:** Create `src/targets.ts`, `src/options.ts`, `src/sdk.ts`, `tests/sdk.test.ts`.

**Interfaces:** Produces `isTarget(providerId: string, modelId: string): boolean`, `assertStateless(options: Record<string, unknown>): void`, and exported `createCopilotReasoning(options)` returning the upstream-compatible provider facade. `assertStateless` consumes normalized effective Copilot options and rejects `store === true`; SDK preparation resolves the namespaces before invoking it.

- [ ] Implement exact target selection and namespace normalization from `github-copilot` and `copilot` into the adapter's `copilot` options using copies. Match OpenCode's effective option merge; contradictory namespace values must be examined as an integration discrepancy, not resolved by an arbitrary new precedence.
- [ ] For targets, capture the original `responses` factory before creating aliases. Select real Copilot Responses with original model IDs, preserve official factory fetch/headers, and guard both `doGenerate` and `doStream` before transport.
- [ ] Preserve unspecified effort and specified effort verbatim. Require stateless mode and encrypted-output inclusion for targets without dropping other includes/options; omit reasoning item IDs only for encrypted target reasoning in stateless requests, never tool IDs.
- [ ] Return upstream Copilot reasoning metadata unchanged. Do not filter older turns or alter non-target SDK behavior.
- [ ] Exercise the public SDK with a recording external fetch: `store:true` causes zero transports, omitted storage becomes false, namespace/effort/include survive, input history remains unchanged, rotated SSE completes, and old-user-turn as well as tool-result fixtures replay encrypted reasoning.
- [ ] Run `bun test tests/sdk.test.ts`. Expected: all specified outcomes pass, with actual vendored SDK code under test. Report checkpoint.

### Task 3: Target-only plugin and configuration errors

**Files:** Create `src/plugin.ts`, `tests/plugin.test.ts`; update package exports and build scripts.

**Interfaces:** Consumes Task 2 target selector and guard. Produces default OpenCode plugin export implementing public `provider.models` and `config` hooks; SDK subpath exports `createCopilotReasoning`. Built outputs are `dist/plugin.js` and `dist/sdk.js`.

- [ ] Implement target-only model replacement using public hook types. Preserve provider identity, other model records, capabilities, and user options. Resolve SDK entry relative to the installed distribution, not a developer's absolute path.
- [ ] Reject explicit target-model `options.store:true` with a credential-free error naming the provider/model and supported stateless mode. Preserve effective-request guards for later overrides; do not silently fall back.
- [ ] Build through `scripts/build.ts`, compiling plugin and SDK with package dependencies external. Provide `bun run build`, `bun run typecheck`, `bun run test`, and `bun run verify:vendor` scripts; no publication script execution.
- [ ] Test hook outputs with real configuration/model records: two targets replaced, other models/providers untouched, explicit conflicts rejected, repeated hooks safe, user effort/other options retained. SDK tests cover later effective `store:true` overrides.
- [ ] Run `bun test tests/plugin.test.ts tests/sdk.test.ts`, `bun run typecheck`, and `bun run build`. Expected: successful builds/types and target-only/error contracts pass. Report checkpoint and review Tasks 1–3 before runtime work.

### Task 4: Built-package installed-runtime integration

**Files:** Create `tests/integration/runtime.test.mjs`, `tests/integration/subagent.test.mjs`, `tests/integration/harness.mjs`.

**Interfaces:** Consumes built plugin/SDK exports, not TypeScript source entrypoints. Harness invokes the human-approved installed OpenCode 1.18.35 with temporary HOME/XDG/database/managed config, synthetic auth, explicit title, stdin EOF, and loopback endpoints; returns sanitized request records and exit results in memory. Existing 1.18.34 results are prototype evidence, not a substitute for product verification.

- [ ] Verify installed-package-style resolution outside the source tree. Use temporary package materialization; inspect packaged contents with `npm pack --dry-run --json` without publishing or installing into the normal profile.
- [ ] For each target, fake encrypted output then continue the same isolated session. Assert next actual HTTP request includes the identical synthetic encrypted payload without reasoning ID, `store:false`, selected effort, and encrypted inclusion. Use rotated SSE IDs; require normal runtime completion.
- [ ] Add a controlled loopback tool-loop case with a harmless synthetic tool/file and exact worktree-relative permission mapping. Assert correct tool-result pairing and replay in a subsequent actual request.
- [ ] Exercise a real OpenCode subagent using a controlled primary fixture and loopback child response. Prove the child selects the target adapter, with separate parent/child call accounting. Do not replace OpenCode's task execution with a hand-written imitation.
- [ ] Add effective `store:true` configuration/variant scenarios that fail before loopback transport. Verify non-target hook records remain unchanged; do not redirect unrelated models merely to make integration pass.
- [ ] Run `bun run build` and `node --test tests/integration/runtime.test.mjs tests/integration/subagent.test.mjs`. Expected: both targets, primary/child selection, active-loop/old-turn replay, package resolution, and conflict guards pass against the real runtime. Report checkpoint; blocked runtime evidence stays incomplete.

### Task 5: Opt-in live acceptance harness and bounded verification

**Files:** Create `scripts/smoke-live.mjs`, `scripts/smoke-support.mjs`, `tests/smoke-controls.test.mjs`; update `docs/compatibility.md`.

**Interfaces:** Consumes built adapter/plugin. Support module supplies synthetic workspace, exact permission map, provider-local recording fetch, sanitized metadata sink, and single-process request budget. No production telemetry or request cap is added to the plugin.

- [ ] Reuse lessons, not diagnostic artifacts: shared four-request reservation across factories before transport, 90-second subprocess limit, output ≤1000 per call, explicit title, stdin closure, fresh isolated state, actual instrumented entrypoint selected in both model override paths.
- [ ] Keep official authentication private and unchanged. Do not write credentials, prompts, ciphertext, raw IDs, request bodies, or arbitrary provider error text to diagnostics. Document that isolated OpenCode history itself can retain sensitive model data.
- [ ] Offline-test the fifth request rejected before transport, concurrent reservations, sink failures fail closed, sentinel-free whitelist telemetry, and pass-through response bytes/content. Verify installed loader sees the instrumentation and correct permissions before proposing live execution.
- [ ] Run `node --test tests/smoke-controls.test.mjs`. Expected: privacy, counting, limits, transport delegation, and exact-path guards pass. No live command runs as part of ordinary test/build/install.
- [ ] Ask separately for each live model session with explicit bounds. After approval only, run `node scripts/smoke-live.mjs --model gpt-6.1-sol` or `--model gpt-6-luna`, one session ≤4 inference requests/90 seconds. No automatic retry.
- [ ] Record independently: normal task completion with successful reads; prior encrypted output followed by no-ID inline replay with `store:false` and successful backend completion; requested effort; auth unchanged. No returned reasoning means replay inconclusive, not a pass. Do not force a performance claim.
- [ ] Document accepted effort levels only with evidence from applicable official/model capability information or separately approved tests. Do not launch an effort-level live matrix under a single smoke approval. If Luna support cannot be established, stop for a human decision rather than silently removing it or claiming support.
- [ ] Report checkpoint with offline results and separately authorized live outcomes; unapproved or inconclusive live checks remain pending, not complete.

### Task 6: Documentation, reproducibility, and final review

**Files:** Create/update `README.md`, `docs/compatibility.md`, `docs/maintenance.md`, package metadata and test scripts as needed; no new product behavior.

**Interfaces:** Documents plugin default export installation shape, supported SDK/host/model matrix, guards and maintenance of Task 1 patches. No npm name/channel or delivery action is chosen implicitly.

- [ ] Document retained-history replay, compaction/model-switch boundaries, supported efforts versus backend defaults, explicit `store:true` errors, primary/subagent use, removal procedure, and no binary rebuild requirement. Installation examples are instructions, not authorization to edit the user's profile.
- [ ] Document upstream provenance/license, dependency checks, patch-drift workflow, host upgrade validation, diagnostic privacy, and known evidence limitations. Do not vendor live histories or credentials.
- [ ] Run `bun run verify:vendor`, `bun run typecheck`, `bun run test`, `bun run build`, installed-runtime tests, and `npm pack --dry-run --json`. Expected: all offline checks pass and package surface contains only intended source/distribution/license/docs, excluding credentials, private logs, databases, and local caches. Cite prior unchanged live results rather than rerun them.
- [ ] Obtain final independent scope-bound review of implementation and evidence. Reproduce findings before fixing in-scope blockers; use at most one same-reviewer follow-up without further human approval.
- [ ] Record review dispositions, verification, pending capability/live gates, and changed files in this plan. Report completion only to the extent observed evidence supports. No commit, push, PR, publication, installation, or cleanup of prior prototypes.

## Plan self-review

Checked design coverage, producer/consumer interfaces, task dependencies, configuration and effective-request guards, exact model scope, retained-history boundaries, effort passthrough, package resolution, subagents, privacy, and review cadence. Prototype-only controls remain in the smoke harness. Model/backend capability facts and live execution remain explicit evidence/approval gates; unknowns cannot be promoted to support claims. Steps do not prescribe test-first ordering or Git delivery. Written-plan approval is required before Task 1.
