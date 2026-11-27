# 1. One tip pipeline

One entry point, one routing rule and one sheet for article and passage tips.
The reader picks an amount; the app picks how to pay.

## 1.1 Routing

```ts
// lib/payments/tip.ts (package P3)
tip({ target, amountCents }): Promise<TipResult>
```

`target` is an article or a passage of an article
([interfaces](interfaces.md#i1-view-models)). A passage target carries a passage id that
is stable across readers (the reading view snaps a selection to sentences;
the id is derived from the article id and the sentence range), and the
receipt's `highlight_id` is that id. A tip to a writer without an article
(a profile or a shared writer link) targets the writer's pinned article
until a writer-level target is added; Core and the vouchers need no change
for either. `amountCents` is an integer
number of US cents. Amounts are never floats in the pipeline.

The route is computed synchronously on the client from two reactive queries
that the session runtime already holds: `balance.session` (the reader) and
`balance.tipContext` (the target). The server re-checks every rule at
acceptance; a route the client computed from stale data fails cleanly and the
sheet re-routes (section 1.8).

`routeTip(input): TipRoute` is a pure function in `lib/payments/route.ts`.
Rules, in order; the first rule that matches decides:

| #   | Condition                                                                            | Route                                                                                                                     |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| R1  | Not signed in                                                                        | `blocked: signed-out` (sheet offers sign-in and keeps the tip, section 1.9)                                               |
| R2  | The reader is the author or a split recipient                                        | `blocked: own-article` (no tip control is rendered)                                                                       |
| R3  | The article is not registered, its payout address is not verified, or Core is paused | `blocked: not-tippable` or `blocked: paused`                                                                              |
| R4  | Every balance condition below holds                                                  | `balance`                                                                                                                 |
| R5  | Every balance condition holds except the device key                                  | `balance` with `setupDevice: true` (one wallet prompt registers this device's key, then the tip is sent from the balance) |
| R6  | A verified wallet address is linked to the account                                   | `wallet`                                                                                                                  |
| R7  | Otherwise                                                                            | `needs-funds`                                                                                                             |

Balance conditions (R4):

1. The reader's Tab account for the chosen token is `OPEN` (not closing).
2. This device holds a key that Convex lists as registered, not revoked, and
   valid for at least `ACCEPT_MARGIN_LEDGERS` (1 day) more.
3. Settlement is enabled on this deployment (`balance.session.settlement.enabled`).
4. `amountCents ≤ limits.perTipCents` and
   `acceptedTodayCents + amountCents ≤ limits.dailyCents` (section 1.3).
5. The article pays one recipient (`tipContext.recipientCount === 1`). Articles
   with splits use the wallet route until the split-legs package (S1 in
   [work packages](work-packages.md)) lands.
6. There is a token `T` that the writer accepts and the reader holds with
   `available(T) ≥ amount(T)` at the current price, and `amount(T) ≥ minTip(T)`.
   With several, the order is: stablecoins before XLM, then the larger
   available amount. Until the assets package lands, `T` is XLM.

The wallet route (R6) does not require the wallet to be connected in this
page: the address is linked to the account ([section 4.3](04-session.md#43-wallet-restore)).
The sheet shows "Pay $X from your wallet" with one press, because this route
opens a wallet prompt. When the balance is short and a wallet is linked, the
sheet also offers "Add funds" as the second action.

`needs-funds` (R7) means no wallet is linked. It offers "Connect a wallet"
and, once the accounts package lands, "Create an account" with a passkey
([document 5](05-accounts.md)). After either, the sheet continues with "Add
funds" and then sends the tip from the balance.

## 1.2 The sheet

One component tree owned by the UI track renders one state machine owned by
the logic track (`useTip(target)`, [interfaces](interfaces.md#i2-headless-hooks)).

The tip control is a labelled button that states the amount ("Tip $1"),
with a visible amount choice beside it (chips, plus "Other"). Both work with
a tap and with the keyboard. A hold-and-slide gesture may be added by the UI
track as a shortcut on top; no function exists only behind a gesture, and
`TipController` has no gesture-only method. A tap on the article text never
sends money.

- Pressing "Tip $X" on the `balance` route starts the hold (section 1.7);
  further presses during the hold add the amount again.
- Any other route opens the sheet at the step the route needs.
- The confirmation never covers or scrolls away the tipped passage.
- A tip does nothing else: acceptance writes money state only. It never
  follows the writer, subscribes the reader, or makes the reader's identity
  public. Any public supporter surface is opt-in and outside the pipeline.

### State machine

```text
            ┌──────────── reroute (1.8) ─────────────┐
            ▼                                        │
idle ──tip()──▶ routed ──balance──▶ holding ──hold ends──▶ sending ──ok──▶ sent
                  │                    │   ▲  │                    │
                  │                    │   └──┘ tip() adds         └─refused/err──▶ failed ──retry──▶ sending (same requestId)
                  │                    └─cancel() or app closed──▶ idle (nothing sent)
                  │
                  ├─balance+setupDevice─▶ device-setup ──signed──▶ sending
                  │                            └─declined─▶ routed
                  ├─wallet──▶ confirm-wallet ──press──▶ signing ──sent──▶ submitted ──server──▶ sent
                  │                 ▲                     │                     └─────────────▶ failed
                  │                 └─────declined────────┘
                  ├─needs-funds──▶ funding ──deposit confirmed──▶ sending (queued tip, balance route)
                  │                   └──"pay from wallet"──▶ confirm-wallet
                  └─blocked──▶ blocked
```

`sent` carries a `settlement` sub-state that the server drives
(`accepted → on-chain → in-wallet`, or `not-paid`). The sheet closes at
`sent`; the activity list shows the rest ([document 2](02-instant-state.md)).

| Phase            | Entry                              | Exit                                                            | Shown                                                    |
| ---------------- | ---------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| `routed`         | `tip()` or an amount change        | route-specific                                                  | amount, route action                                     |
| `device-setup`   | route `balance` with `setupDevice` | wallet signed `Tab.register_key` and Convex verified it by hash | "Approve once to tip from this device"                   |
| `holding`        | "Tip $X" pressed, balance route    | 3 s after the last press (5 s ceiling), or `cancel()`           | "Sending $3" and Cancel; balance unchanged               |
| `sending`        | the hold ended                     | `balance.send` answered                                         | "Sending $3"; balance unchanged until the server accepts |
| `confirm-wallet` | route `wallet`                     | the reader presses "Pay from wallet"                            | amount, wallet address (short)                           |
| `signing`        | press                              | the wallet answered                                             | "Approve in your wallet"                                 |
| `submitted`      | `recordSubmitted` stored the hash  | `getTipStatus` final                                            | "Sending", confirming quietly                            |
| `funding`        | route `needs-funds` or "Add funds" | deposit confirmed (verified by hash) or cancelled               | deposit amount, then "Adding $10"                        |
| `failed`         | any refusal or error               | retry, reroute, or close                                        | one sentence and one action                              |

## 1.3 Limits

v2 limited a balance tip to 5 XLM and a day to 20 XLM (`TAB_TIP_MAX`,
`TAB_DAILY_LIMIT`). v3 replaces both with limits in cents, checked at the
acceptance price:

| Setting (Convex env)      | Default | Rule                                                        |
| ------------------------- | ------- | ----------------------------------------------------------- |
| `BALANCE_TIP_MAX_CENTS`   | 2000    | A balance tip is at most $20.                               |
| `BALANCE_DAILY_MAX_CENTS` | 10000   | Balance tips accepted per UTC day are at most $100.         |
| `QUICK_TIP_MAX_CENTS`     | 500     | Presses during one hold add up to at most $5 (client rule). |

A tip above a limit is routed to the wallet (R6) or to funding, never refused
for the limit alone. The limits bound the damage of a misused device key and
of mistakes; the balance cap of the Tab contract bounds the rest
([contract changes](contracts.md#c2-tab)). `acceptedToday` moves from base
units to cents (`tabAccounts.acceptedTodayCents`).

## 1.4 The balance route

v2 accepted a balance tip in two mutations (`tabs.prepareTip`, then
`tabs.submitTip`). v3 accepts it in one, because every value the client signs
is already in reactive state:

1. `balance.tipContext({ articleId, keyId, token })` returns the article key,
   the content hash, the writer address and the pair state
   `{ seq, cumulative, segmentRoot, leafHashes }` for this reader, key, writer
   and token. The session runtime subscribes when the tip control mounts.
2. The client builds the receipt: `seq + 1`, `amount` at the price of
   `balance.session.prices[token]` (`priceAt` identifies it),
   `cumulativeAfter = cumulative + amount`, `clientRef = sha256(requestId)[0..16]`,
   the content hash and the highlight id.
3. The local ledger check of v2 (spec 5.6 step 2, `decideStepTwo`) runs
   unchanged: the client never signs a cumulative below one it signed before.
4. The device key signs the voucher payload (no prompt).
5. `balance.send({ requestId, articleId, highlight, token, keyId, amountCents, priceAt, receipt, signature })`
   re-runs every acceptance rule of v2 `checkTabTip` (with the cent limits of
   1.3), recomputes the amount from `amountCents` and the price identified by
   `priceAt`, verifies the signature, countersigns, and writes the receipt,
   the voucher, the account's `outstanding`, the writer's earnings and both
   activity rows, then calls `requestSettlement` ([document 3](03-settlement.md)).

`priceAt` must name the current cached price or the one before it, and be at
most `TAB_PRICE_MAX_AGE_MS` old. Otherwise `balance.send` throws
`BALANCE_PRICE_CHANGED` with the current price; the client re-signs once.

If the pair changed between step 1 and step 5 (another browser tab on the
same device, which shares the key, tipped the same writer; two devices have
separate keys and so separate pairs), `balance.send` throws `BALANCE_PAIR_CHANGED` with the new pair state;
the client re-signs once with it. A second conflict surfaces as `failed` with
a retry.

### Receipt segments

v2 capped a pair at 256 receipts (`MAX_RECEIPTS_PER_PAIR`); the reader then
needed a new key. v3 keeps 256 leaves per Merkle tree and chains trees: when a
pair reaches 256 receipts, the next receipt starts a new segment whose first
leaf is the previous segment's root. The voucher's `receipts_root` is the
current segment's root. The contract treats the root as opaque, so this needs
no contract change. `tabVouchers.segment` (number) and
`tabReceipts.segment` record it.

## 1.5 The wallet route

Unchanged in the contract: `Core.tip` with `client_ref`, signed by the wallet.
Unchanged in Convex: `tipsV2.prepareDirectTip` and `tipsV2.prepareHighlightTip`,
`recordSubmitted`, `recordSendFailed`, `getTipStatus`. Changes:

- The pipeline calls them; `useTipV2Flow` and the v2 dialog are removed
  ([document 8](08-removals.md)).
- Verification and earnings are immediate ([section 2.4](02-instant-state.md#24-transactions-the-app-sends)).
- A wallet tip appears in both activity lists at `submitted`
  ([section 2.3](02-instant-state.md#23-wallet-tips)).

## 1.6 The basket

Removed. A balance tip needs no approval, so batching approvals has no reader
value. `Core.tip_batch` stays in the contract (no change) but no client calls
it. Removed with it: `tipsV2.prepareBatch`, `hooks/useTipBasket.ts`,
`lib/tip/v2/basket.ts`, `lib/tip/v2/open-basket.ts` and the basket
components ([document 8](08-removals.md)).

## 1.7 The hold

There is no reversal after acceptance: a writer never sees a tip that is
then taken back, and vouchers stay monotonic. The way back from a mistaken
press is a short hold before anything is sent.

- The hold starts at the first press of "Tip $X" on the `balance` route and
  ends `HOLD_MS` (3 s) after the last press, at most `HOLD_MAX_MS` (5 s) after
  the first. Presses during the hold add their amount, up to
  `QUICK_TIP_MAX_CENTS`. The control shows the running amount and Cancel; the
  copy says "Sending $3", never "Tipped" or "Sent".
- During the hold nothing is signed, nothing is written to the outbox and
  nothing reaches the server. Closing the app, reloading, navigating away from
  the article or `cancel()` ends the hold with nothing sent, and nothing shows
  on reopen.
- When the hold ends, one tip of the summed amount goes through the balance
  route (one `requestId`). The balance and the activity list change only when
  `balance.send` returns `ACCEPTED`; no optimistic update before acceptance.
- After acceptance the tip is final. There is no Undo control and no
  server-side reversal.
- The wallet and funding routes have no hold: their own confirmation press
  is the commitment.
- Slice 1 ships without the hold: a press sends at once.

## 1.8 Failure cases

| Case                                           | Server answer                                | Pipeline                                                                      |
| ---------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| Double tap                                     | (none: a lock in `useTip`)                   | One `requestId` in flight per target                                          |
| Network loss after `balance.send` was sent     | unknown                                      | Outbox resubmits the same `requestId` and signature; same answer (idempotent) |
| Pair changed (other browser tab)               | `BALANCE_PAIR_CHANGED` + pair state          | Re-sign once, then `failed`                                                   |
| Price moved                                    | `BALANCE_PRICE_CHANGED` + price              | Re-sign once                                                                  |
| Balance short (another device spent it)        | `BALANCE_OVER_AVAILABLE`                     | Reroute (R6 or R7) with the same amount; no new prompt without a press        |
| Over a limit                                   | `BALANCE_TIP_MAX` or `BALANCE_DAILY_MAX`     | Reroute                                                                       |
| Key revoked or expiring                        | `BALANCE_KEY_REVOKED`, `BALANCE_KEY_EXPIRED` | Reroute to `device-setup`                                                     |
| Settlement off or Tab paused                   | `BALANCE_SETTLEMENT_OFF`, `BALANCE_PAUSED`   | Reroute to wallet                                                             |
| Article changed (content hash, payout address) | `BALANCE_TARGET_CHANGED`                     | Refresh `tipContext`, re-sign once                                            |
| Wallet declined                                | (client)                                     | Back to `confirm-wallet`; nothing sent                                        |
| Wallet tip failed on chain or expired          | `getTipStatus` final `FAILED`/`EXPIRED`      | `failed` with "Try again" (new `requestId`)                                   |

Every refusal code maps to one sentence in `lib/copy/` owned by the UI track;
the logic track exports the code list (`BALANCE_ERROR_CODES`).

## 1.9 Idempotency

- `requestId` is a UUID made when the hold ends. One `requestId` is one tip attempt
  on one route. A reroute after a refusal makes a new `requestId`; a refused
  attempt has no effect, so this cannot double-pay.
- `balance.send` is idempotent on `requestId`: the same request with the same
  receipt and signature returns the first answer; any other payload under an
  accepted `requestId` is refused (`BALANCE_DUPLICATE_REQUEST`). The receipt's
  `clientRef` is derived from `requestId`, so the v2 uniqueness index on
  `clientRef` also holds.
- The client outbox (`IndexedDB quilltip-session`, store `outbox`) keeps each
  attempt from signing (after the hold) until the server answers. On load, the session runtime
  resubmits balance attempts and resumes wallet attempts from `getTipStatus`.
  Entries older than 24 hours are dropped.
- A tip started while signed out is kept in `sessionStorage`
  (`quilltip:pending-tip`, target and amount only) and the sheet reopens after
  sign-in. No signature exists before sign-in.

## 1.10 Schema and API changes

- New `convex/balance.ts`: `session`, `tipContext`, `send`, deposit
  and device functions ([interfaces](interfaces.md#i3-convex-functions)).
  `tabs.prepareTip` and `tabs.submitTip` are removed.
- `tabReceipts.segment`,
  `tabVouchers.segment` and a registry `token` id on `tabAccounts`, `tabVouchers` and `tabReceipts` (derived from the Tab instance) are added.
- `tabAccounts.acceptedToday` (base units) becomes `acceptedTodayCents`.
- `tips` and `highlightTips` keep `channel`; balance tips write `channel: 'tab'`
  as today. `requestId` is set on every v3 row.
- `tipsV2.prepareBatch` is removed.

## 1.11 Tests

- `routeTip`: a table test over every rule R1 to R7 and every balance
  condition, including stale session data.
- `balance.send` in `convex-test`: acceptance, every refusal code, idempotent
  repeat, conflicting repeat, pair change from a second browser tab, two
  devices tipping one writer at once (two pairs, both accepted), price
  change, segment roll at receipt 257.
- Pipeline with injected deps (`lib/payments/tip.ts`): every state machine
  edge; presses during a hold add up and send one request; cancel and a
  simulated app close during the hold send nothing and leave no outbox entry;
  outbox resubmit after a reload during `sending`; reroute after each
  refusal; no second request while one is in flight.
- Contract-level: a voucher over a two-segment pair settles (root is opaque).
- Playwright (fake session, phone viewport): the labelled button and the
  amount choice work by tap and by keyboard; the hold shows "Sending $X" and
  Cancel; the balance changes only after acceptance; the tipped passage stays
  visible; every route renders its step.
