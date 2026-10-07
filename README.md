# Copilot GPT reasoning replay

A removable OpenCode plugin selecting a pinned Copilot Responses adapter for
exactly `github-copilot/gpt-6.1-sol` and `github-copilot/gpt-6-luna`, in primary
and subagent sessions. No OpenCode binary rebuild or alternative login is needed.
DCP integration is not included. No performance improvement is claimed.

**Pre-release verification.** The provisional local name
is `opencode-gpt-reasoning`, version `0.0.0`, and the package remains private.
The human intends a later npm release; final name, version, channel and release
permission are unresolved. This is not a publication-ready claim.

## Installation shape

Build the checkout with `npm ci` and `bun run build`. For an explicitly authorized
local installation, add the built root plugin to your OpenCode config and restart:

```json
{
  "plugin": ["file:///absolute/path/opencode-gpt-reasoning/dist/plugin.js"],
  "model": "github-copilot/gpt-6.1-sol"
}
```

The checkout's production dependencies must remain installed. Use the root
`plugin.js`, not `sdk.js`; it resolves the sibling SDK relative to its installation.
These instructions do not authorize editing a normal profile or changing auth.

Future npm installation would use the root package entry, for example:

```json
{ "plugin": ["opencode-gpt-reasoning"], "model": "github-copilot/gpt-6.1-sol" }
```

That name is provisional, not a currently published installation promise. Replace
it with the exact name/version selected for a separately authorized release.

## Effort and storage

Keep existing model options or named variants; for example a target model's
`options` or selected variant may contain `{"reasoningEffort":"high"}`. The
plugin preserves specified effort rather than imposing a new global default.
Unspecified effort remains unspecified. The adapter accepts strings, **not a
verified backend enum**; catalog-advertised values and observed `high` acceptance
are separated in [compatibility](docs/compatibility.md).

For example, merge this into existing configuration, then select the `high`
variant in OpenCode (the variant name itself does not imply backend support):

```json
{
  "provider": {
    "github-copilot": {
      "models": {
        "gpt-6.1-sol": {
          "options": { "store": false },
          "variants": { "high": { "reasoningEffort": "high" } }
        }
      }
    }
  }
}
```

Targets use `store:false` and request encrypted reasoning output. Explicit
`store:true` in target configuration fails with a credential-free error naming
the provider/model; effective request overrides (including later variants/agents)
also fail before transport. Errors propagate; there is no silent model/adapter
fallback. Neighboring models and other providers are not selected by the plugin.

## Replay boundaries

Encrypted reasoning and summaries present in supplied retained same-model history
are preserved, including earlier user turns and active tool loops. Caller history
is not mutated, tool IDs remain paired, and reasoning can replay inline without
an item ID. Copilot streaming and official OpenCode authentication remain in use.
The plugin cannot recover compacted/pruned history or force restoration across
model/provider switches. It introduces no turn-age filter. `store:false` is a
response storage mode, not a promise of zero retention under all provider policy.

## Removal and verification

Remove this plugin entry from config and restart OpenCode; retain existing auth.
No auth deletion, binary rollback or DCP changes are required.

See [compatibility](docs/compatibility.md) for bounded Sol/Luna task-and-replay
evidence and its limits, and [maintenance](docs/maintenance.md) for offline checks, provenance,
upgrade procedure and separately approved manual smoke usage. Ordinary tests,
builds and installs do not run live inference.
