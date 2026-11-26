# Tab client modules (`lib/stellar/v2/tab/`)

Browser-side code for tabs (prepaid quick tips): the session key, the voucher
and receipt builders, the local ledger, and the one function that turns a
`tabs.prepareTip` result into a `tabs.submitTip` argument. These modules never
call a wallet and never decide that a tip is confirmed. Convex accepts a tab
tip; the chain settles it later.

Spec: [03 Tab contract](../../../../docs/architecture/v2/03-tab-contract.md)
3.4 to 3.7, [05 Flows](../../../../docs/architecture/v2/05-flows-and-admin.md)
5.5 and 5.6, [06 App integration](../../../../docs/architecture/v2/06-app-integration.md)
6.6, and [07 Security](../../../../docs/architecture/v2/07-security-and-recovery.md)
7.2 and 7.4.

| File              | Responsibility                                                                    |
| ----------------- | --------------------------------------------------------------------------------- |
| `encoding.ts`     | Shared byte encoders (voucher, acceptance, receipt, Merkle). Also used by Convex. |
| `config.ts`       | Passphrase and Tab contract id from `v2Config()`.                                 |
| `session-key.ts`  | Key generation, storage, binding to `key_id`, signing, status.                    |
| `merkle.ts`       | Receipts and roots in the hex form Convex stores.                                 |
| `voucher.ts`      | Prepare checks, receipt and payload builders, `submitTip` argument.               |
| `local-ledger.ts` | Per `(key_id, writer)` record and the step-2 rule of spec 5.6.                    |
| `sign-tip.ts`     | `signTabTip` and `commitAcceptedTip`.                                             |
| `index.ts`        | Public API. Import from `@/lib/stellar/v2/tab`.                                   |

## API

### Opening a tab or adding a key (spec 5.5)

```ts
import { createSessionKeyStore, tabScope } from '@/lib/stellar/v2/tab'

const keys = createSessionKeyStore()
const scope = tabScope(readerAddress) // Tab contract from v2Config()

const key = await keys.generate(scope) // pending: key.info.keyIds is []
await prepareOpen({
  amount,
  publicKey: key.info.publicKey,
  validUntil,
  spendLimit,
  extractable: key.info.extractable, // true only for the fallback
})
// Build Tab.open_session (or register_key), simulate, wallet signs, send.
// Once getMyTab lists the key:
await keys.bindKeyIds(scope, tab.keys) // matches by public key
```

If the wallet step fails or is cancelled, the pending key stays unbound. Call
`key.forget()` to remove it, or keep it and retry with the same public key.

### Tipping from the tab (spec 5.6)

```ts
import {
  commitAcceptedTip,
  defaultTabSigningDeps,
  signTabTip,
} from '@/lib/stellar/v2/tab'

// Passphrase and Tab contract id from v2Config(), never from a response.
const deps = defaultTabSigningDeps({ readerAddress })

let prepared = await prepareTip({ requestId, articleId, amountCents, keyId })
let result = await signTabTip(prepared, deps)
if (result.kind === 'retry_prepare') {
  prepared = await prepareTip({
    requestId: newId(),
    articleId,
    amountCents,
    keyId,
  })
  result = await signTabTip(prepared, deps)
}
if (result.kind === 'signed') {
  const accepted = await submitTip(result.submit) // retry with the same args
  await commitAcceptedTip(accepted, deps)
}
```

- `signTabTip(prepared, deps)` returns one of:
  - `{ kind: 'signed', submit, voucher, replay }`. `submit` is the exact
    `tabs.submitTip` argument. `replay` is true when this repeats a voucher
    already signed here (same `prepareId`); the stored signature is reused.
  - `{ kind: 'retry_prepare', reason }`. Prepare once more with a new
    `requestId` and call `signTabTip` again. `reason` is a `MismatchReason`
    or `concurrent_update` (another browser tab committed an acceptance for
    the pair meanwhile).
  - `{ kind: 'stop', reason, message }`. Do not sign. See the table below.
- `commitAcceptedTip(accepted, deps)` appends the accepted leaf. It is safe to
  repeat and safe with two browser tabs. It throws `TabClientError`
  `LEDGER_CONFLICT` when the acceptance does not extend what this browser
  signed; the next `signTabTip` then applies the ledger rule.
- If `submitTip` throws a network error, resubmit the same `result.submit`.
  Convex returns the same acceptance. Do not prepare a new tip for it.
- `signTabTip` never refuses a prepare for its age: `expiresAt` is server
  time and the device clock can be off. If `submitTip` fails with
  `TAB_PREPARE_EXPIRED`, prepare again. A replay of an accepted tip returns
  the stored signature at any age.

### Key status for the UI

```ts
import { createSessionKeyStore, tabKeyState } from '@/lib/stellar/v2/tab'

const localKeys = (await keys.list(scope)).map((k) => k.info)
const { status, keyId } = tabKeyState({
  serverKeys: tab.keys, // getMyTab
  localKeys,
  currentLedger, // getMyTab / chain status
})
```

`sessionKeyStatus` gives the status of one key; `key.status(serverKey,
currentLedger)` does the same for a loaded key.

### Errors

Expected outcomes are results, not exceptions. `TabClientError` has a `code`:

| Code                  | Meaning                                                      |
| --------------------- | ------------------------------------------------------------ |
| `STORAGE_UNAVAILABLE` | IndexedDB is missing or blocked (some private modes).        |
| `CRYPTO_UNAVAILABLE`  | No WebCrypto and no secure random source.                    |
| `KEY_NOT_FOUND`       | `markUnusable` on a key this browser does not hold.          |
| `INVALID_INPUT`       | Malformed argument.                                          |
| `LEDGER_CONFLICT`     | An acceptance does not extend this browser's signed history. |
| `NOT_CONFIGURED`      | `NEXT_PUBLIC_TAB_CONTRACT_ID` is not set.                    |

## How the UI presents each state

Tab tips are testnet activity; label them so.

| State (`tabKeyState`, `StopReason`)                      | Meaning                                                                   | UI                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ready`                                                  | This browser holds an active key.                                         | Offer "Tip from tab" with no wallet prompt.                                                           |
| `pending`                                                | A key was generated here; registration is not confirmed yet.              | "Setting up quick tips". Offer to finish or cancel the wallet step.                                   |
| `missing`, `key_missing`                                 | Convex has an active key this browser does not hold (cleared or evicted). | "This device's quick-tip key is gone." Offer "Set up quick tips on this device" (register a new key). |
| `expired`                                                | Within 1 day of `valid_until`, or past it.                                | "Your quick-tip key expired." Offer a new key.                                                        |
| `revoked`                                                | Revoked on chain or in the app.                                           | Offer a new key.                                                                                      |
| `unusable`, `key_unusable`                               | This browser stopped the key after a ledger mismatch.                     | "Quick tips are stopped on this device." Offer a new key and, optionally, revoking the old one.       |
| `ledger_mismatch`                                        | Just stopped: the tab history differs from this device twice.             | As `unusable`. Report it (it means a server or storage fault).                                        |
| `none`                                                   | No key.                                                                   | Offer "Prepay for quick tips".                                                                        |
| `pair_full`                                              | 256 receipts for this writer under this key.                              | Offer a new key.                                                                                      |
| `above_limit`                                            | Above the caller's `maxAmount`.                                           | Show the limit.                                                                                       |
| `wrong_tab`, `wrong_reader`, `malformed`, `inconsistent` | The prepare response is not usable.                                       | "Something went wrong. Try again." Report it; never retry automatically more than once.               |

In every case the reader's funds are safe: accepted vouchers still settle,
and the balance stays withdrawable (spec 7.4).

## Storage layout

One IndexedDB database, `quilltip-tab` (version 1), with two stores. Both
live in one database so an eviction removes them together.

- `sessionKeys`, key path `[tab, reader, publicKey]`; multi-entry index
  `byKeyRef` on `keyRefs` (`"<tab>|<reader>|<keyId>"`).
  - `keyIds`: on-chain ids bound to this public key (empty while pending; two
    ids if the same public key was registered twice).
  - `backend`: `webcrypto` holds a non-extractable `privateKey` `CryptoKey`;
    `noble` holds the 32-byte `seed`.
  - `extractable`, `createdAt`, `unusable` (`{ reason, at }` or null).
- `ledgers`, key path `[tab, reader, keyId, writer]`:
  - `committed`: `{ seq, cumulative, leafHashes }` as Convex last confirmed it
    to this browser, or null.
  - `signed`: the last 16 vouchers signed here (`seq`, `cumulativeAfter`,
    `leafHash`, `prepareId`, `signature`). Entries above `committed.seq` are
    pending.
  - `mismatchAt`: set by a first mismatch.

The Tab contract id fixes the network, so the network is not a key part.

### Concurrency

Each read-check-write is one IndexedDB `readwrite` transaction, and IndexedDB
runs those one at a time across all tabs of the origin. That keeps each
record consistent. It does not serialise tips: signing is asynchronous and
runs outside a transaction.

What this gives, and what it does not:

- **Two browser tabs can sign the same `seq`.** Both check the same committed
  state, both sign, and both store a pending entry. One tab that prepares
  twice for the same `seq` can also sign twice.
- **Convex accepts at most one of them.** `submitTabTip` accepts a voucher
  only on top of the pair's current state; the other gets
  `TAB_STALE_PREPARE` (spec 5.6, step 3.3). That tab prepares again on the
  new state and signs the next `seq`.
- **The reader never pays more than intended.** A voucher is cumulative and
  carries only this reader's own amounts on the history Convex showed, so
  whichever voucher for the pair settles pays at most what the reader meant
  to tip.
- The write after signing is a compare-and-set against the committed state
  the check saw. It returns `retry_prepare` with `concurrent_update` when
  another tab committed an acceptance for the pair in the meantime. It does
  not detect another tab's pending entry.

Web Locks are not used. A per-pair lock would stop two tabs signing the same
`seq`, but it needs a rule for a lock held by a tab that closed, and Convex
already refuses the second voucher. The fixture suite tests the two-tab case
in all three engines.

### The ledger rule (spec 5.6, step 2)

`decideStepTwo` is the pure rule; `matchLedger` is the comparison.

1. With a local record, `cumulativeBefore` and `leafHashes` must equal it.
   Without one, they must be `0` and empty.
2. On a mismatch, re-read the record once (another tab may have written).
3. Still a mismatch: `retry_prepare` and set `mismatchAt`.
4. A mismatch on the next prepare too: `stop`, and the key is marked
   `unusable` in this browser.

Write-ahead: a signed voucher is stored before the submit goes out. If Convex
accepts it and the response is lost, the next prepare shows exactly that leaf;
it matches the signed entry and is promoted instead of stopping the key. Only
vouchers this browser signed can be promoted, so this adds no exposure.

## Threat notes for callers

- **The key never leaves the browser.** No function returns the seed or the
  `CryptoKey`. Never send either anywhere; the server only needs the public key.
- **Non-extractable is not unusable.** A script running in the app origin can
  sign with the key handle. The bound is Convex acceptance (daily and per-tip
  limits), the key's `spend_limit`, and its lifetime (spec 3.5, item 7).
  Keep the default lifetime and spend limit small.
- **Fallback keys are extractable.** Where WebCrypto Ed25519 is missing, or the
  engine cannot store a `CryptoKey` in IndexedDB, the seed sits in IndexedDB
  and a script in the origin can read it. Pass `extractable: true` to Convex,
  and the UI may show it.
- **Eviction.** Clearing site data, or Safari's 7-day eviction without a visit,
  removes the key and the ledger together. The tab shows `missing`; the reader
  registers a new key. Funds are not affected.
- **Signatures are not always deterministic.** WebKit's WebCrypto Ed25519 signs
  with a random nonce, so the same voucher signed twice gives two different
  valid signatures. Never re-sign to retry a submit: resubmit the same
  `submit` argument (the ledger keeps the signature for replays).
- **Content security policy.** The modules need no inline script,
  `'unsafe-eval'` or WebAssembly. `@noble/curves` is plain JavaScript.
- **`Buffer`.** `encoding.ts` imports `Buffer` from the `buffer` package.
  Do not use the global `Buffer` in code that runs in the browser or in the
  Convex default runtime: neither has one.

## Tests

- `bun run test:unit` runs `scripts/tab/*.test.ts` (fake-indexeddb, Node
  WebCrypto): every branch above, the shared vectors byte for byte, two-writer
  and multi-receipt sequences, and concurrent commits.
- `bun run test:e2e:fixtures` runs `e2e/tab-session-keys.spec.ts` in Chromium,
  Firefox and WebKit against `e2e/fixtures/tab/` (port 4181), under the app's
  production content security policy.
