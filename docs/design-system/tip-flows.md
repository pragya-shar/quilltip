# Tip flows (payments v2)

How a reader tips an article, a passage, or several of them at once on
payments v2. The states, their copy and the shared components come from the
payment state kit ([payment-states.md](payment-states.md)); this page covers
what the tip flows add on top: where each surface lives, the amount form, the
basket, refusals that have no kit notice, and reloads.

- Flow code: `lib/stellar/v2/tip-calls.ts` (encoder and checks),
  `lib/stellar/v2/tip-actions.ts` (runner), `lib/tip/v2/` (state machine,
  basket, amounts, refusals, reload record).
- Components: `components/tipping/v2/` and the two entry points,
  `components/tipping/TipButton.tsx` and
  `components/highlights/HighlightTipButton.tsx`.
- Copy: `lib/copy/tip-flow.ts`.
- Fixture with every state: `e2e/fixtures/tips-v2/` (port 4179), tested by
  `e2e/tips-v2.spec.ts`.
- Lifecycle rules: [06-app-integration.md, section 6.1](../architecture/v2/06-app-integration.md#61-transaction-lifecycle).

## Entry points

`TipButton` and `HighlightTipButton` render the v2 flow. The article tip area
and `HighlightTipGate` read `chain.articles.getArticleTipAvailability` first:
with payments v2 off (`disabled`) or paused, they show "Tips are paused for a
short time while payments are updated." instead of a button. The flow loads
with `import()`, so the article page's first load does not hold it.

## Surfaces

| Surface       | Desktop (768 px and up)                 | Mobile (below 768 px)                           |
| ------------- | --------------------------------------- | ----------------------------------------------- |
| Article tip   | The tip dialog (`.tip-dialog`)          | The same dialog, full width less 16 px gutters  |
| Highlight tip | The tip dialog, with the passage quoted | The same                                        |
| Tip basket    | A sheet from the right, 26 rem wide     | A bottom sheet, up to 85 % of the screen height |
| Basket button | Fixed, bottom right, above the page     | Fixed, bottom, full width less gutters          |

The basket button appears on article pages only while the basket holds a tip
or a basket payment has a result to show. It is a real button in the page's
tab order, after the article's support area, and reads "Tip basket, 2 tips".
References: cart drawers (Hers, Dollar Shave Club, Etsy on the web) and cart
bottom sheets (WHOOP, Hers on iOS) in Mobbin.

## Article and highlight tip

1. **Availability.** `getTipEligibility` decides. An article that cannot take
   tips shows `TipsUnavailableNote` in place of the button (`unregistered`,
   `payout_outdated`; `pending` comes from `getArticleTipAvailability`). While v1 preparation is paused before v2 is on (cutover step 4), the same note reads "Tips are paused for a short time while payments are updated." in place of both the article and the passage tip buttons (`paused`). A
   reader's own article shows no tip button. Account problems (signed out, no
   wallet, unverified) do not hide the button; the dialog shows the gate.
2. **Amount.** Presets of $1, $2 and $5 (`aria-pressed` buttons) and "Other
   amount" in dollars. The dialog has one amount for both ways to send it
   (see "From your tab" below); while a quick tip is on offer, no preset is
   above the tab tip maximum. The smallest amount is `minTipCents` from
   `getTipEligibility`; the largest is $100. Errors show under the field and
   are linked with `aria-describedby`. The XLM figure is an estimate
   (`AmountSummary estimate`) at the cached price until prepare returns.
3. **Start.** The send button sits inside the `WalletGate`. Its name carries
   the dollar amount as the app shows it: "Send $1 tip"; the basket's reads
   "Send $2.25 in 2 tips". Until the amount is valid it reads "Send tip" and is
   `aria-disabled`; pressing it shows the error. "Add to tip basket"
   needs only a signed-in reader. After prepare, the summary shows the
   prepared amounts (gross, author share, platform fee).
4. **Progress and result.** `TransactionProgress` with the record from
   `tipsV2.getTipStatus`. The result summary is the chain amount
   (`chainTotals.netBaseUnits` to the author) once the server has it.
5. **Retry.** Only when the record says `canRetry`, as a new prepare with a new
   `requestId`.

## From your tab (#546)

Both dialogs mount `LazyTabTipAction layout="dialog"` between the amount
summary and the wallet tip, so a reader with an open tab sends the dialog's
amount with this browser's session key and no wallet prompt. The tab code
loads with `import()` when the dialog opens (`components/tab/README.md`).

- **Raw limits, the client's clock.** `tabs.getMyTab().tipLimits` holds raw
  values only: `TAB_TIP_MAX`, the daily limit with the total accepted on
  `acceptedDay` (UTC), the chain minimum, the cached price with its fetch
  time and `priceMaxAgeMs`, and `tipMaxCents` at that price. A subscribed
  query does not re-run as time passes, so the section applies the UTC day
  and the price's age with its own clock (`tabTipLimitsAt`), wakes at the
  next change (`nextLimitsChange`: the price turning stale, or 00:00 UTC),
  and checks again at the press.
- **One amount.** The tab section has no amount choices of its own. While the
  tab can send and the price is fresh, it reports the largest tab tip; the
  dialog then offers presets up to it (`tabTipPresets`: the maximum, rounded
  down to 5 cents from 20 cents up unless that is below the minimum, and the
  largest smaller steps; never above the maximum), and the amount hint adds
  "Tab tips go up to {max} at today’s XLM price."
- **Explained before sending.** `checkTabTipAmount` applies prepare's checks
  in prepare's order to the chosen amount: no fresh price, below the minimum,
  above the maximum, today's limit, the free balance, this device's spend
  limit. A failing check shows its notice in the section, the send button is
  `aria-disabled` and described by the notice, and nothing reaches Convex, so
  an expected refusal never logs a Convex error in the console.
- **Primary action.** With a ready tab, "Send {amount} from your tab" is the
  primary button and the wallet button reads "Send {amount} tip from your
  wallet" under a "From your wallet" heading. Otherwise the wallet tip stays
  primary.
- **Busy and result.** While the quick tip sends, the dialog cannot close.
  Accepted, settled and the other receipt results replace the amount and the
  wallet tip; "Done" closes the dialog and "Send another" returns to the form.

| State                               | The section shows                                                          |
| ----------------------------------- | -------------------------------------------------------------------------- |
| Loading                             | One placeholder line, the height of the "no tab" line                      |
| Signed out, unverified, tabs off    | Nothing: the wallet gate covers it                                         |
| No tab                              | "Tip without a wallet prompt from a prepaid tab." and an "Open a tab" link |
| Co-author splits                    | The kit's splits note; the wallet tip stays                                |
| No key on this device, key problems | The key's own notice and next step                                         |
| Settlement off, tab closing         | The kit notice; the wallet tip stays                                       |
| Ready                               | Free balance, "No wallet prompt…", "Send {amount} from your tab"           |
| Above the maximum                   | "Tab tips go up to {max} right now", send disabled                         |
| Not enough free balance             | The kit's tab balance notice with "Top up", send disabled                  |
| Today's limit, device limit, price  | Their notices, send disabled                                               |
| Sending, accepted, settled, other   | `TransactionProgress` for `tab-tip`, from the receipt status               |

Fixture: `/dialog?state=<id>` on the tab UI fixture (port 4183), tested by
`e2e/tab-tip-dialog.spec.ts` in both dialogs.

## Refusals without a kit notice

Prepare refusals map through `lib/tip/v2/prepare-errors.ts`. Every server code
in `TIP_V2_ERROR_CODES` has an entry (a unit test checks the list). Each shows
as a `PaymentNotice` of kind `refused` with the form kept, and says nothing was
paid.

| Code                                           | Title                                   | Detail                                                                                      |
| ---------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `BELOW_MINIMUM`                                | This tip is below the minimum           | The smallest tip right now is {min}. Choose a larger amount. Nothing was paid.              |
| `INVALID_AMOUNT`                               | Choose another amount                   | A tip is from $0.01 to $100.00. Nothing was paid.                                           |
| `RATE_LIMITED`                                 | Too many tips in a short time           | Wait {n} seconds, then try again. Nothing was paid.                                         |
| `PRICE_UNAVAILABLE`                            | No XLM price right now                  | Quilltip can’t convert this amount yet. Try again in a minute. Nothing was paid.            |
| `CHAIN_V2_DISABLED`                            | Tips on Stellar testnet are not on here | This Quilltip site has not turned them on. Nothing was paid.                                |
| `CHAIN_CONFIG_MISSING`, `CHAIN_CONFIG_INVALID` | Tips are not set up on this site        | Try again later. Nothing was paid.                                                          |
| `SELF_TIP`                                     | You can’t tip your own article          | Tips for this article come to you. Nothing was paid.                                        |
| `HIGHLIGHT_INVALID`                            | This passage changed                    | Select the passage again, then tip it. Nothing was paid.                                    |
| `BATCH_TOO_LARGE`                              | Too many tips for one payment           | One payment holds up to 10 tips and 24 transfers. Remove a tip, then pay. Nothing was paid. |
| Other codes, or no answer                      | Quilltip could not prepare this tip     | Try again in a minute. Nothing was paid. (No answer: "Quilltip could not be reached".)      |

The rest use kit states: `UNAUTHENTICATED`, `NO_WALLET` and
`ADDRESS_UNVERIFIED` the wallet gate; `PAUSED` the paused notice;
`ARTICLE_NOT_REGISTERED`, `ARTICLE_NOT_FOUND` and `PAYOUT_ADDRESS_CHANGED`
tips unavailable, or the basket item notice for a basket.

Before signing, the client checks the prepared values against its own
configuration and the request (`checkPreparedTip`): network, Core, token,
tipper address, item count and order, method, time bound, `article_id`,
amount against the quote, `client_ref` uniqueness, and `highlight_id`
recomputed from the passage. A mismatch is recorded as `wallet_rejected:
client_check` and shown as "This request does not match Quilltip’s settings".
A wallet on another account than the linked one shows "Switch your wallet to
{address}".

An insufficient balance (the token contract's `BalanceError`, #507) shows the
kit's balance notice with the amount needed and what the wallet can spend,
read from the account entry (balance minus the reserve).

## Basket

- Up to 10 tips and 24 transfers in one `Core.tip_batch`; each tip counts its
  recipients plus the platform fee (`getTipEligibility().transferCount`).
- "Add to tip basket" explains a refusal next to the button, in a polite live
  region:

  | Reason       | Title                                  | Detail                                                                    |
  | ------------ | -------------------------------------- | ------------------------------------------------------------------------- |
  | 10 tips      | Your basket is full                    | One payment holds up to 10 tips. Send these first.                        |
  | 24 transfers | This tip doesn’t fit in one payment    | It needs {n} transfers and {left} are left of 24. Send your basket first. |
  | Same tip     | Already in your basket                 | To change its amount, remove it from your basket, then add it again.      |
  | Article      | This article can’t take tips right now | It can’t be added to your basket.                                         |
  | Paying       | Your basket is being paid              | Wait for the result, then add more tips.                                  |

- The basket is kept in this browser per account (`localStorage`). The server
  checks every item again at prepare; an item that fails is named in the
  basket with the kit's basket notice, and "Remove it" removes it.
- Paying shows the kit's progress, then a row per tip with its own
  `PaymentStatusLabel`: one tip can end "Sent to updated address" or "Under
  review" while the others read "Confirmed". The result follows
  `phaseFromBatch`.
- After a result where money moved (confirmed, sent to an updated address,
  under review), "Done" empties the paid tips from the basket. After `FAILED`
  or `EXPIRED` the tips stay, and "Try again" pays them with a new request.

## Reload and lost responses

The flow stores the submission ID per surface (`lib/tip/v2/pending.ts`), and
the transaction hash once `sendTransaction` accepted it. On the next load:

- The surface opens on the record from `getTipStatus`; the trigger shows "Your
  last tip is being checked" with "View".
- A record still `PREPARED` with a stored hash gets `recordSubmitted` again (a
  repeat is free). Without a hash it shows the kit's resuming state until the
  indexer confirms it or it expires.
- A lost prepare response is retried once with the same `requestId`; the server
  returns the same record. A record already past `PREPARED` is followed, never
  signed again. If simulation reports Core `DuplicateClientRef`, the earlier
  send landed: the flow follows the record and records no failure.

## Motion and accessibility

The flows add no motion of their own: the dialog and sheet use the existing
open and close transitions (off under reduced motion), and the confirmation is
the kit's one authored moment. Every control is a real button or input, at
least 44 px high. Focus moves to the progress heading when a payment starts
and to the result title when it ends (the kit). "Added to your tip basket" is
announced politely.
