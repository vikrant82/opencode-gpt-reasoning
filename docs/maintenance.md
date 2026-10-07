# Maintenance and verification

## Provenance and licensing

The adapter is pinned to OpenCode tag `v1.18.34`. Provenance records the immutable
**tree reference** `aec0b9a6d8898f68f923aaf08b7306d931fd9d76`; do not relabel
that field as a verified commit SHA. `vendor/provenance.json` records immutable
raw origins, Git blob IDs and pristine SHA-256 hashes for 25 subtree files and
the upstream MIT license. Root `LICENSE` covers this package; retain the upstream
license in root `LICENSE` (the provenance ledger's actual local license path)
when distributing the bundled adapter.

`vendor/patches/manifest.json` records four reversible replacements in three
approved classes: stateless no-ID encrypted replay (type and converter), exact
target reasoning classification, and same-index encrypted retention (non-null
done payload wins, otherwise start payload survives). No blanket model-family
patch or generic OpenAI stream replacement is authorized.

The tarball allowlist includes distribution/declarations, README, these two docs,
licenses, and vendored source/provenance/patch ledger for auditability. It excludes
tests, smoke scripts, design/plan artifacts, local caches, auth, database/history
and captures. Both root plugin and `./sdk` exports have declarations. The pinned
plugin package is a production dependency because the root declaration imports
its public `Plugin` type; json-schema types also remain a production dependency.

## Offline checks

```sh
npm ci
bun run verify:vendor
bun run typecheck
bun run test
bun run build
bun run test:integration
bun run test:smoke-controls
npm pack --dry-run --json
```

Consumer tests create and install a real tarball with `npm install --omit=dev`,
then strictly check both exports with NodeNext, `skipLibCheck:false` and only
Node ambient types. The compiler executable is supplied by the checkout, not
its module/type-resolution tree. Consumer Node types are an explicit normal
consumer prerequisite, not fabricated Bun globals. Temporary fixtures are deleted.
Integration/control tests use synthetic auth and loopback transport on installed
OpenCode 1.18.35; registry access may be needed for isolated dependencies.
The Bun script selects TypeScript suites; Node integration and controls use their
separate named scripts rather than Bun's incomplete `node:test` compatibility.
CI should run all three ordinary offline scripts, never automatically invoke the live script.

Before a dependency or host upgrade, inspect licenses and run a vulnerability
check such as `npm audit --omit=dev`; assess advisories, do not apply automatic
upgrades. Resolve a proposed immutable upstream reference, preserve pristine
hash evidence, reapply only approved patches and run the vendor verifier. Patch
drift or a broader behavior change requires renewed approval, not a silent edit.
Repeat strict production consumer, converter/stream/SDK/hook and installed-host
primary/subagent/variant tests before adding host compatibility claims. Live
reconfirmation, normal-profile installation and publication need separate consent.

## Manual live smoke: separate approval for each session

Only after approval of one specific model session:

```sh
node scripts/smoke-live.mjs --model gpt-6.1-sol
# Alternatively, a separately approved Luna session:
node scripts/smoke-live.mjs --model gpt-6-luna
```

Do not run both under one approval or retry automatically. One session shares
at most four inference HTTP reservations, 90 seconds across at most two prompts,
and at most 1000 output tokens per request, with actual requested effort `high`.
Dependency preparation precedes that bounded inference lifecycle. The second
prompt is conditional on successful first task, final reasoning and remaining
budget/time. These caps/instrumentation are harness controls, not plugin features.

The runner reads only the official Copilot auth entry in private memory and uses
the built-in authenticated transport. Public inference is guarded to exact
`https://api.githubcopilot.com/responses`; enterprise auth requires separate
destination/policy authorization and is rejected by this harness. Official auth
size/mtime/inode are checked unchanged. Child-only auth is never diagnostic data.

Fresh temporary HOME/XDG/database/state and synthetic files isolate the session;
all owned isolated state, history and evidence are deleted in `finally`. Model
history can contain sensitive output/encrypted state even though diagnostics
whitelist only counts, flags and statuses. Never publish it. A child environment
can contain credentials visible to processes running as the same OS user:
temporary isolation is not a same-user security boundary. Normal profiles and
official user auth remain unchanged.

Interpret `firstTaskSuccess`, `taskChecks`, normal completion, active-loop and
cross-turn replay acceptance, continuation success/status and aggregate replay
separately. Exit status alone is not replay proof; final-only encrypted output
without a subsequent matched input is inconclusive. Current `taskChecks` identify
which task predicates pass. The latest separately approved bounded Sol and Luna
runs both passed task and cross-turn replay criteria; earlier Luna task/allowlist
failure remains unexplained because its history was deleted. Do not infer a fix
or cause from later offline diagnostics. These observations do not establish every
advertised effort level or performance. Package publication, installation, and
release identity/channel still require their separate decisions and authorization.
