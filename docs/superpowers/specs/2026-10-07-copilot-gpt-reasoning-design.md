# Copilot GPT reasoning replay plugin

## Workflow checkpoint

- Route: Design + Plan.
- Subject: standalone OpenCode plugin and pinned Copilot SDK adapter.
- Project: `opencode-gpt-reasoning` (repository root).
- Direction approved: 2026-10-07; human selected approach 1, pinned Copilot adapter plus narrow plugin overrides.
- Configuration decision approved: 2026-10-07; explicit target-model `store:true` is rejected with a clear configuration error, not silently overridden or routed to the original adapter.
- Host-version amendment approved: 2026-10-07; test installed OpenCode 1.18.35 as an additional compatibility target while retaining the v1.18.34 vendored adapter. Support is conditional on observed verification, not approval alone. The affected implementation-plan amendment is approved by the same human decision.
- Stream-metadata amendment approved: 2026-10-07; retain encrypted reasoning captured at item start when completion omits it, preferring a non-null completion payload. Human approved the correction and its regression tests; affected design and plan scope amended together. No live execution or profile installation included.
- Written design: approved by the human on 2026-10-07.
- Implementation plan: `docs/superpowers/plans/2026-10-07-copilot-gpt-reasoning.md`, approved by the human on 2026-10-07.
- Implementation: authorized within the approved plan.
- Delivery: installation into normal profiles, publication, commits, pushes, and PRs require separate authorization.

## Confirmed scope

The initial product supports exactly `github-copilot/gpt-6.1-sol` and `github-copilot/gpt-6-luna`. It applies wherever OpenCode selects either model, including primary and subagent sessions. DCP is independent and out of scope.

The plugin preserves encrypted reasoning from the retained same-model transcript, including earlier user turns and active tool loops, while keeping `store:false`. It does not introduce an active-turn-only filter or claim that replay improves performance by a particular amount.

## Goal and success criteria

Provide a removable, version-pinned workaround for Copilot GPT reasoning replay without rebuilding OpenCode or enabling server-side response storage.

Success requires:

1. The installed OpenCode runtime selects the replacement only for the two supported models on the `github-copilot` provider.
2. Requests retain `store:false`; encrypted reasoning can serialize inline without a reasoning item ID.
3. Both supported models are recognized as reasoning models. Supported requested effort reaches the request; the plugin does not choose a new global effort default. Support is not restricted to the prototype's `high` setting: preserve each effort level accepted by both the pinned adapter and the selected Copilot model. Do not claim arbitrary strings or identical supported levels across models; verify their capability sets before documenting the accepted levels.
4. Existing Copilot streaming behavior handles its lifecycle IDs without substituting the generic OpenAI adapter.
5. Authentication and transport remain owned by OpenCode's existing Copilot integration.
6. Offline tests cover model selection, replay, streaming, metadata mapping, and untouched non-target behavior. Separately authorized live checks cover each target model, successful tools, replay when reasoning is returned, and normal completion.
7. A primary/subagent integration check verifies that the override is not limited to primary sessions. It is offline unless live verification is separately approved.

## Evidence and limitations

OpenCode v1.18.34 tagged source strips Responses item IDs under `store:false`; its bundled Copilot converter requires an ID before emitting encrypted reasoning. Its Responses reasoning classifier also excludes these GPT-6 model names.

A disposable exact-version Copilot adapter prototype preserves the original stream handling and adds no-ID replay plus exact Sol reasoning classification. Installed-runtime offline replay passes. A live Sol run returned encrypted reasoning, then accepted its inline replay without an ID and finished normally. That run's synthetic reads were permission-denied because of a harness worktree-path mismatch; its exact permission correction has only been tested offline. An earlier adapter run completed successful reads but had no recorded reasoning.

Luna has not been tested. Sol evidence does not establish Luna's endpoint, effort support, replay acceptance, or subagent behavior. No performance benchmark has been performed. Prototype telemetry and request limits are test-harness controls, not product features.

## Architecture and components

### 1. OpenCode plugin entry

Use the public provider-model hook and narrowly guarded configuration override proven by the prototype. Preserve all other provider and model records. Select the packaged SDK for the two exact target IDs under `github-copilot` only. The configuration override addresses OpenCode's later merge of explicit model configuration; it must not erase unrelated model options.

Retain the provider ID so existing authentication remains selected. Do not implement another login flow, copy credentials, or depend on private user configuration paths. Package-entry resolution must work from a built distribution outside the source checkout.

### 2. External Copilot SDK

Vendor the self-contained Copilot SDK subtree from an immutable OpenCode v1.18.34 source reference, with its license, file provenance, pinned dependencies, and an explicit local patch manifest. Keep pristine upstream material distinguishable from local modifications.

Preserve the upstream Responses and Chat implementations. The target facade explicitly routes supported Responses models through the real Copilot Responses implementation, without relabeling model IDs. Catalog endpoint and capability handling must be verified for Luna before claiming support; a materially different endpoint requires returning to design approval.

Local behavioral patches are limited to:

- Missing reasoning ID plus encrypted content under `store:false`: emit the reasoning item inline, preserving its summary, omitting the absent ID, and never inventing an ID. Preserve existing ID-present and `store:true` converter branches for regression compatibility, although this product's supported mode is `store:false`.
- Exact reasoning-model classification for `gpt-6.1-sol` and `gpt-6-luna`. No blanket GPT-family change.
- Encrypted reasoning metadata retention: at reasoning completion, use non-null done-event encrypted content, otherwise retain the content captured for that same active output index. Preserve existing stream correlation and state cleanup. Start-only, done-only, neither, and differing start/done payloads require regression coverage; non-null done content wins.

### 3. Metadata bridge

An alternate SDK package identity changes OpenCode's provider-options mapping. Translate the `github-copilot` namespace to the adapter's `copilot` namespace for request-level options and message-part metadata, accepting the adapter's existing namespace as well.

Work on copies, not caller-owned history. Preserve encrypted payloads and tool-call IDs. For target encrypted reasoning in stateless mode, omit reasoning item IDs as demonstrated by the prototype. Preserve upstream `copilot` output metadata so OpenCode stores reasoning for later replay. Capture SDK factory methods before assigning facade aliases to avoid recursive dispatch.

### 4. Tests and opt-in smoke harness

Keep offline fixtures and loopback integration tests independent of real credentials. A separately invoked live harness may use the official auth integration with explicit human approval; it must not run during ordinary tests, installation, or plugin startup.

The live harness uses a fresh isolated session, narrowly allowed synthetic tools, hard pre-transport request and time/output bounds, and sanitized telemetry. No request bodies, ciphertext, raw lifecycle IDs, text, or credentials are written to diagnostic logs. OpenCode's own isolated history can retain model output and encrypted state; document that artifact as sensitive and do not publish it.

## Data flow and replay boundaries

`OpenCode retained history → target SDK selection → metadata bridge → real Copilot converter → official authenticated transport → Copilot SSE parser → OpenCode persisted parts → next request`.

There is no turn-age filter. The adapter serializes valid reasoning present in OpenCode's supplied history; it does not reconstruct compacted history or force reasoning across provider/model switches. Compaction, cross-model conversion, and any separately installed pruning plugin remain outside its control.

Sending reasoning does not prove the provider uses every prior item or bills it in a particular way. `store:false` controls response retention mode, not historical usage counters or a guarantee of zero server retention under every provider policy.

## Configuration and error behavior

Initial support is stateless. Preserve user effort choices where the selected model supports them; request encrypted reasoning output as needed for stateless replay. Reject explicit `store:true` for a supported target model with a clear, credential-free configuration error. Do not silently override the setting or leave that model on the original adapter. Check target-model configuration before use and guard the effective request options against later agent, variant, or plugin overrides; do not send a conflicting request. The implementation plan must verify the public configuration and SDK seams support these checks. If they do not, stop and return to design approval rather than silently falling back.

Propagate existing adapter and transport errors; never silently fall back to the defective bundled converter or another model. Do not catch and suppress signed/encrypted replay failures. Unsupported non-target models remain outside the override.

Document OpenCode 1.18.34 as the prototype's initial verified host version. OpenCode 1.18.35 is additionally approved for product integration testing; record it as verified only after those tests pass. Keep the vendored adapter pinned to v1.18.34. Do not claim v2 or general version compatibility without testing. Do not add private runtime hooks merely to enforce a version check.

## Rejected alternatives and trade-offs

- Generic OpenAI adapter plus stream normalization: rejected because actual Copilot lifecycle IDs caused text/reasoning parser failures. It duplicates compatibility logic already present upstream.
- Enable `store:true`: rejected as a workaround because it changes retention and uses server-side references with separate compatibility concerns.
- Patch/rebuild OpenCode: rejected for this product because the public plugin/external SDK seam is proven and avoids a custom binary.
- Active-loop-only reasoning replay: not selected; introduces a separate context policy unlike the retained-history behavior under discussion.

The cost of the chosen approach is maintaining a vendored adapter and testing OpenCode hook/SDK compatibility on updates. Keep the patch set narrow and expose its provenance rather than promising automatic upstream adaptation.

## Verification coverage

- Converter: ID-present and missing-ID encrypted replay; empty and nonempty summaries; missing encrypted data; unchanged stored-reference branch; valid tool call/result data.
- Streaming: Copilot rotated lifecycle IDs, stable text/reasoning events, encrypted metadata, generation and streaming seams.
- Classification: both exact target IDs transmit effort; nearby non-target IDs retain baseline serialization.
- Bridge: both namespaces, request options and part metadata, input immutability, factory alias safety.
- Plugin/package: target-only selection, preserved provider identity/options, installed distribution loading, non-target records unchanged.
- Runtime: isolated real OpenCode persistence and replay, earlier user-turn and active tool-loop boundaries, primary/subagent selection.
- Smoke controls: actual instrumented entry selected, counter sees every inference request, cap enforced across factories in a single diagnostic process, privacy sentinels, narrow worktree-relative tool permissions, auth unchanged.
- Live: separately authorized Sol and Luna runs; distinguish backend replay acceptance, task success, and performance. A run without returned encrypted reasoning is inconclusive for replay, not a passing replay test.

## Risks and unresolved questions

- Luna endpoint and reasoning-effort capabilities must be established before its compatibility claim is accepted.
- Official auth/fetch and provider hooks can change between OpenCode versions. Host-version expansion requires new compatibility evidence.
- Cross-model history may be transformed before the plugin sees it; no workaround is introduced here.
- Vendored code and SDK dependencies require licensing, vulnerability, and patch-drift checks on updates.
- Human intends a later release and npm publication. Package name and publication channel remain later delivery decisions; no publication is currently authorized.
- A fully successful live task combining encrypted replay and successful reads remains outstanding for both targets. Test execution must be separately approved; no live retries are implicit.

## Design self-review

Checked scope, evidence versus claims, target/provider identity, retained-history policy, authentication ownership, packaging seams, failure behavior, tests, and delivery boundaries. Resolved prototype-versus-product ambiguity by excluding telemetry/caps from production behavior and preserving stateless mode. Human approved rejection of explicit target-model `store:true`; the design now specifies configuration checks and an effective-request guard without silent fallback. Effort passthrough is not limited to the prototype's `high` setting; accepted levels remain adapter/model-capability dependent. Luna compatibility and live task success remain explicit verification gates rather than assumed facts. Human approved the written design on 2026-10-07; planning is now authorized, implementation is not yet authorized.
