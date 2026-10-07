# Local patch ledger

`manifest.json` contains exact, single-occurrence before/after replacements against
the immutable upstream files recorded in `../provenance.json`. Reverse those four
replacements to recover pristine bytes; apply them to those bytes to reproduce
the local adapter. No chat, factory, effort schema, or tool code changes; streaming
changes are limited to the completion metadata fallback below.

1. Missing-ID encrypted reasoning is emitted inline only for explicit
   `store:false`, preserving an empty or nonempty summary and omitting `id`.
   The companion input type makes `id` optional to represent that wire shape.
2. Exactly `gpt-6.1-sol` and `gpt-6-luna` enter the existing reasoning branch.
3. Reasoning completion prefers non-null done-event encrypted content, then the
   content already captured for the same active output index, then null. Existing
   summary IDs, rotated-ID correlation, and state cleanup remain unchanged.

The pristine v1.18.34 adapter already captures optional `encryptedContent` on
`response.output_item.added` and emits it at reasoning start, but originally emits
only `done.encrypted_content ?? null` at reasoning end. OpenCode replaces start
metadata with end metadata, losing start-only payloads. This defect predates the
local replay/classification patches: reversing this ledger recovers the unchanged
pristine SHA-256 and Git blob hashes in `../provenance.json`.

Run `bun run verify:vendor` offline to verify all pristine SHA-256 and Git blob
hashes, patch application, inventory, and local import closure. Existing upstream
TODO comments are retained upstream material, not new local work items.
