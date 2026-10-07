# opencode-gpt-reasoning

Preserve GPT reasoning across tool calls and conversation turns in OpenCode's
GitHub Copilot integration—without rebuilding OpenCode or enabling server-side
response storage.

## Why this exists

A reasoning model can return an **encrypted reasoning item** alongside its answer
or tool call. Passing that item back gives the model access to its previous
reasoning state, not just the visible answer and tool results. This is different
from displaying a readable reasoning summary or counting reasoning-output tokens.

For multi-step coding tasks, preserving this state may improve reasoning
continuity, token efficiency, and model performance. OpenAI's
[reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)
recommends returning reasoning items during function-calling workflows.
With `store:false`, encrypted items can be sent inline: server-side item storage
is not required for replay.

The inspected OpenCode Copilot adapter could store encrypted reasoning locally
but fail to send it back. In its stateless request path, OpenCode strips reasoning
item IDs, while the converter requires an ID before emitting the encrypted item.
We also found reasoning-effort classification gaps for the supported GPT models
and loss of encrypted content when a stream's completion event does not repeat
content supplied at item start.

This plugin addresses those compatibility gaps. Its goal is to bring OpenCode's
Copilot reasoning-history handling in line with harnesses such as
[Pi](https://github.com/earendil-works/pi), which preserves reasoning items when
converting retained same-model history into Responses input.

**Replay is verified; performance improvement is not benchmarked.** Preserving
reasoning enables the intended continuation mechanism, but does not guarantee
better answers on every task or identical performance to another harness.

## What the plugin fixes

It uses a pinned copy of OpenCode's actual Copilot adapter, preserving its
Copilot-specific streaming behavior and existing authentication. Three narrow
patches:

1. **Stateless replay:** emit encrypted reasoning even when its item ID is absent.
2. **Reasoning effort:** recognize the two supported model IDs and pass through
   the selected effort instead of silently omitting it.
3. **Stream persistence:** retain encrypted content captured at item start when
   the completion event omits it; prefer completion content when supplied.

The plugin overrides only these models, in both primary and subagent sessions:

- `github-copilot/gpt-6.1-sol`
- `github-copilot/gpt-6-luna`

Other models and providers are left untouched. No additional login is needed.

## Upstream context

These references explain related upstream work; their scope and status matter:

- [OpenCode issue #25065](https://github.com/anomalyco/opencode/issues/25065):
  reports later-turn encrypted-reasoning failures with `store:false`.
- [OpenCode PR #38247](https://github.com/anomalyco/opencode/pull/38247):
  proposes stateless replay changes, including the Copilot converter;
  **closed without merging**.
- [OpenCode PR #34686](https://github.com/anomalyco/opencode/pull/34686):
  merged Copilot metadata/ID handling changes, but does not by itself establish
  encrypted replay without an ID.
- [AI SDK PR #12869](https://github.com/vercel/ai/pull/12869): merged support for
  encrypted reasoning without an item ID in its OpenAI converter. That is not
  the separate Copilot converter bundled by OpenCode.
- [Pi's Responses history conversion](https://github.com/earendil-works/pi/blob/28dcce2ba45ce4a9efeb0f5b686f0be830fd89b9/packages/ai/src/api/openai-responses-shared.ts#L145):
  a reference implementation for retaining reasoning in supplied history.

This is a version-pinned workaround, not a claim that every current or future
OpenCode/provider combination has these defects. See
[compatibility](docs/compatibility.md) for the tested versions and evidence.

## Install from source

The package is not yet published to npm. Its intended npm name is
`@vikrant82/opencode-gpt-reasoning`; the checkout currently remains private at
version `0.0.0`.

Install dependencies and build using Node/npm and Bun:

```sh
git clone https://github.com/vikrant82/opencode-gpt-reasoning.git
cd opencode-gpt-reasoning
npm ci
bun run build
```

Add the built plugin to your OpenCode configuration, preserving existing entries,
then fully quit and restart OpenCode:

```json
{
  "plugin": ["file:///absolute/path/opencode-gpt-reasoning/dist/plugin.js"],
  "model": "github-copilot/gpt-6.1-sol"
}
```

The checkout's production dependencies must remain installed. Use the root
`plugin.js`, not `sdk.js`; it resolves the sibling SDK relative to its installation.
There are no plugin-specific configuration options. Continue selecting models
and reasoning effort through OpenCode's normal model, agent, and variant settings.

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
No authentication deletion or binary rollback is required.

See [compatibility](docs/compatibility.md) for bounded Sol/Luna task-and-replay
evidence and its limits, and [maintenance](docs/maintenance.md) for offline checks, provenance,
upgrade procedure and opt-in live smoke usage. Ordinary tests,
builds and installs do not run live inference.
