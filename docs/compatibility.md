# Compatibility evidence

Evidence checkpoint: 2026-10-07. Both bounded product task-and-replay gates have
now been observed for Sol and Luna; this is not publication or installation
approval. Package identity/channel and release authorization remain unresolved.

## Host, adapter and public package

| Surface | Evidence boundary |
| --- | --- |
| OpenCode 1.18.35 | Product offline installed-runtime/loopback primary, real subagent, earlier-turn/tool-loop replay and config/variant guards verified; bounded product live sessions below |
| OpenCode 1.18.34 | Initial prototype host evidence, not a full product runtime test |
| Other hosts / v2 | Not verified |
| Adapter | Pinned OpenCode v1.18.34; provenance tree `aec0b9a6d8898f68f923aaf08b7306d931fd9d76` |
| Package | Provisional `opencode-gpt-reasoning`, private `0.0.0`; final npm name/channel/release permission unresolved |

The root default export is the plugin; `./sdk` exports `createCopilotReasoning`
and conventional alias `createOpenaiCompatible`. Targets use real Copilot
Responses; callable/`languageModel` target dispatch, copy-on-write namespace
bridge, encrypted output inclusion and pre-transport stateless guards are now
implemented. Explicit Chat and non-target SDK behavior remain upstream.

Runtime dependencies are pinned `@ai-sdk/provider@3.0.16`,
`@ai-sdk/provider-utils@4.0.51`, `zod@4.1.8`,
`@types/json-schema@7.0.15`, and public plugin types `@opencode-ai/plugin@1.18.34`.
See [maintenance](maintenance.md) for licenses, provenance and patch verification.

## Effort: advertised is not verified

Public sources inspected without credentials: [models.dev catalog](https://models.dev/api.json)
(`github-copilot`) and [GitHub supported-model documentation](https://docs.github.com/en/copilot/reference/ai-models/supported-models).
The latter lists GPT-6 Luna and GPT-6.1 Sol as GA; that does not establish replay
or every effort level. Both catalog records advertise reasoning and tools.

| Exact target | Catalog-advertised effort strings, not a verified backend enum | Product live observation |
| --- | --- | --- |
| `github-copilot/gpt-6.1-sol` | `low`, `medium`, `high`, `xhigh`, `max` | Responses HTTP 200 with actual `high`; cross-turn replay accepted |
| `github-copilot/gpt-6-luna` | `none`, `low`, `medium`, `high`, `xhigh`, `max` | Responses HTTP 200 with actual `high`; active-loop and cross-turn replay accepted |

The adapter's `z.string().nullish()` preserves specified strings; it is not proof
of arbitrary backend acceptance. Unspecified effort stays unspecified. No live
effort matrix was executed and no identical supported-level set is promised.

## Latest separately approved live outcomes

These cite existing observations; documentation work did not rerun live requests.
Earlier sessions below are historical and do not describe the latest outcomes.

| Latest bounded session | Sol | Luna |
| --- | --- | --- |
| CLI exit | 0 | 0 |
| Actual completed inference HTTP requests | Four, all 200 | Four, all 200 |
| First task / normal stop | Successful / normal | Successful / normal |
| Persisted tool evidence | Two expected reads; no failed, outside, non-read, or unknown-status attempts | Same |
| Active-loop replay accepted | false | false |
| Cross-turn replay accepted | true | true |
| Continuation | Successful | Successful |
| Aggregate replay accepted | true | true |
| Auth | Original unchanged | Original unchanged |

Both latest sessions observed actual matching model/provider, `high`, encrypted
inclusion, 1000-token cap, and stateless flag true (the raw `store` field was not
returned for the latest Luna run). Luna request input/output/prior-match counts
were `[0,0,0]`, `[0,1,0]`, `[1,1,1]`. Sol request four matched one prior output;
its earlier per-request arrays are retained in the historical record below.
Together, observed task success and aggregate replay acceptance satisfy these
bounded Sol/Luna product gates. This does not verify every advertised effort,
performance, or broader version compatibility.

Earlier Luna session (historical, not latest): active-loop replay was accepted,
but task success and `onlyAllowed` were false; the cause is unknown because its
history was deleted. Later offline diagnostics do not establish that they fixed
behavior or recover that cause. Earlier inconclusive runs are preserved as history,
not current gate status. No performance benchmark or billing/retention claim is made.

Offline persisted-tool diagnostics now count completed/error read and non-read
attempts, reads whose recorded path is outside the exact allowlist, and missing
or unrecognized statuses. These are classifications of retained attempts, not
proof that a read was denied or that unauthorized content was accessed; arbitrary
error text is deliberately not interpreted. Exact path matching is unchanged.

## Offline evidence and privacy

Previously recorded Task 6 checks: **92/92** Bun TypeScript tests pass, including two
consumer/build tests; strict production-only NodeNext declarations pass without
Bun ambient types. Typecheck, build and offline vendor verification pass (26
pristine hashes/blobs, four replacements, three patch classes, 67 closed imports).
Dry-run packaging shows 63 allowlisted files with no auth, captures, databases,
tests or private state; the consumer test also installs the actual tarball.

Real converter, stream, facade and plugin tests protect replay/summaries,
non-target preservation, effort passthrough, metadata retention, history
immutability and errors. Installed-runtime tests use a real production tarball
and OpenCode 1.18.35 with synthetic transport/auth, including a Sol primary's
actual task tool selecting a Luna child with separate histories.

After portable path substitution and sanitized bootstrap diagnostics, the combined Node command
`node --test tests/smoke-controls.test.mjs tests/integration/runtime.test.mjs tests/integration/subagent.test.mjs`
passed **70/70** in 76.21 seconds, with zero failures, cancellations or skips:
**59 smoke controls + 11 installed-runtime integration tests**. The host remained
OpenCode **1.18.35**, with adapter pin **1.18.34**. Packaging checks require the
intended docs/provenance/license, reject design/plan artifacts and private state,
and both public exports resolve from the production-only tarball installation.
Synthetic active-loop and final-only
cross-turn cases are mechanics evidence, not additional live backend evidence.

Temporary fixtures use `path.join(os.tmpdir(), 'opencode-gpt-reasoning')`, created
before private `mkdtemp` workspaces; the installed host uses
`path.join(os.homedir(), '.opencode/bin/opencode')`. Child PATH is constructed
from standard directories, the home-relative Bun directory and Homebrew, never
inherited. No real npm configuration, credentials or shared user cache is copied.
One isolated public-registry preparation validates plugin **1.18.35** and its
lockfile, then copies the fixture into each smoke workspace. A suite setup failure
reports sanitized stage, exit code, signal, timeout boolean and allowlisted npm
code, never raw stderr, URLs or external error paths. Rejected preparation remains
rejected; no automatic retries or bootstrap/runtime budget increases were added.
The earlier 42-pass/11-bootstrap-failure result discarded its underlying npm
diagnostics, so a cold-fetch timeout remains an unproven historical hypothesis.

Smoke reservations span factories/processes; fifth inference is rejected before
transport, with one aggregate 90-second deadline across two prompts and a 1000
token output cap. Prior identities restore only from error-free normally stopped
same-model/provider isolated history. Authoritative non-null done metadata wins.
Diagnostics omit bodies, text, ciphertext, raw IDs, headers, credentials and
arbitrary errors. Sensitive isolated histories are deleted, not packaged.
Child auth/environment has a same-user visibility caveat; see maintenance.
Ordinary tests/build/install never read real auth or automatically invoke live
inference. Each public live session requires separate approval; enterprise
destination approval is a distinct gate.
