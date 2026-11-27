# Payment states

Every payments v2 flow (tips, the tab, collecting, the article NFT) shows the
same small set of states: something stands between the reader and the wallet,
a transaction is on its way, the server has an answer, or a standing condition
blocks the action. This document defines those states, their copy, and the
shared components in `components/payments/` that render them.

- Components: `components/payments/` (presentational, no Convex or wallet code).
- State model: `lib/payments/ui-state.ts`. Failure mapping:
  `lib/payments/failures.ts`. Amounts and dates: `lib/payments/format.ts`.
- Copy: `lib/copy/payment-states.ts` and `lib/copy/tips-unavailable.ts`. A unit
  test fails when a string there is missing from this document.
- Fixture with every state: `e2e/fixtures/payments/` (port 4180), tested by
  `e2e/payment-states.spec.ts`.
- Lifecycle rules: [section 6.1](../architecture/v2/06-app-integration.md#61-transaction-lifecycle).
  Edge cases: [section 7.3](../architecture/v2/07-security-and-recovery.md#73-edge-cases).

## Rules

1. **The server decides.** `TransactionProgress` takes the record, not a
   phase, and derives the phase itself. A payment reads as confirmed only
   when Convex reports `CONFIRMED` (or a tab tip `SETTLED`), or, for a tab
   operation with no record, when the indexed tab state shows the change.
   Client polling never confirms.
2. **Retry only when the record allows it.** "Try again" needs a `failed`,
   `expired` or `declined` phase and a record that is `FAILED` or `EXPIRED`
   and not flagged `needsReview`. Never after `MISMATCH`: money may have
   moved. A retry always starts a new prepare with a new `requestId`.
3. **Claims follow knowledge.** "Nothing was sent" appears only where the
   client knows no transaction left the wallet (a refused simulation, a wallet
   refusal, a refused send). Copy speaks about money only from
   server-verified chain data: a settled, unpaid or expired record, or a
   confirmed event. A failed or expired record that the server flags
   `needsReview` reads as under review, because the payment may have landed.
4. **Amounts are chain values.** The kit formats base units it is given. A
   figure computed in the client before prepare returns is an estimate and
   reads "About".
5. **Every amount and every transaction link carries the testnet label.**
   The fixture suite fails when a state with either has no "Stellar testnet"
   label.
6. **A payment in progress always renders.** Standing conditions (tips
   unavailable, paused, the wallet gate, other notices) only block starting a
   new payment or a retry. With a payment in progress they render above the
   progress view, never instead of it. `resolvePaymentView` applies this rule
   for every flow.
7. **Load the kit when the payment starts.** Flows import the kit with
   `import()` (for example `next/dynamic`) when the reader opens the tip
   dialog or the tab page, not in the article page's first load. The kit has
   no value import from `lib/stellar/v2`, the Stellar SDK or the wallet kit; a
   unit test walks its imports to keep it that way (`scripts/perf` forbids
   them in the first load).

## Components

| Component             | Renders                                                                      | Key props                                                                                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WalletGate`          | Signed out, no wallet, not connected, locked, wrong network, unverified      | `state`, `onSignIn`, `onInstall`, `onConnect`, `onRecheck`, `onVerify` or `verifyHref`, `busy`, `help`                                                                                                                              |
| `TransactionProgress` | Steps (prepare, approve, send, confirm), then the result panel               | `flow`, `source`, `audience`, `txHash`, `summary`, `onRetry`, `retryAllowed`, `startedByUser`, `onCancel`, `failure`, `slow`, `resultPlace`, `reference`, `helpHref`, `unlocksAround`, `doneAction`, `resultDetail`, `headingLevel` |
| `AmountSummary`       | Total in XLM, testnet label, cents quote, breakdown and basket rows          | `total`, `breakdown`, `items` (each with optional `status` and `note`), `quoteCents`, `label`, `estimate`                                                                                                                           |
| `PaymentNotice`       | Standing conditions and refusals (below)                                     | `kind` plus kind-specific fields; `action` (`onClick` or `href`, optional `label`, `emphasis`); `announce`                                                                                                                          |
| `PaymentStatusLabel`  | One status in a history or basket row, for example "Settling"                | `phase`                                                                                                                                                                                                                             |
| `SessionKeyRow`       | One quick-tip key on the tab page: device, expiry, spend used, revoke, renew | `label`, `expiresAround`, `expired`, `revoked`, `used`, `limit`, `onRevoke`, `onRenew`                                                                                                                                              |
| `XlmAmount`           | An inline XLM amount with tabular figures, kept on one line                  | `amount`, `estimate`                                                                                                                                                                                                                |
| `ShortAddress`        | "GBZX…MADI", the full address in the tooltip                                 | `address`                                                                                                                                                                                                                           |
| `TestnetLabel`        | "Stellar testnet", optionally with "Practice funds only"                     | `detail`                                                                                                                                                                                                                            |
| `ExplorerLink`        | "View the transaction" on stellar.expert (testnet), new tab                  | `hash`                                                                                                                                                                                                                              |

`PaymentPanel`, `TransactionSteps`, `PaymentSpinner`, `NoticeActionButton`
and `useAnnouncement` are internal building blocks. Every message uses
`PaymentPanel`: a tinted surface, a full hairline border, a leading icon, a
title, a detail and up to two actions.

### Reused, not rebuilt

- `TipsUnavailableNote` renders the tips-unavailable state on the article page
  and inside `PaymentNotice`; both read `lib/copy/tips-unavailable.ts`.
- `WalletSetupHelp` and `InstallWalletDialog` stay the install help. Pass
  `<WalletSetupHelp />` to the gate's `help` slot and open
  `InstallWalletDialog` from `onInstall`.
- `ReceivingWalletVerification` stays the full verification screen for
  writers. The gate's `verifyHref` links to it.
- `formatXlmFromStroops` in `lib/copy/network-status.ts` formats amounts.
- The step sentences are one table (`STEP_COPY`), also used by the article
  tips panel.

## The state model

### `resolvePaymentView`: what a flow renders

`resolvePaymentView({ source, gate, notice, tipsUnavailable })` returns:

| Field       | Meaning                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `progress`  | The derived phase, retry and redirected-row count. When set, render `TransactionProgress`, whatever else is true.                     |
| `condition` | The one standing condition to show. Precedence: tips unavailable, paused, the wallet gate, any other notice.                          |
| `showStart` | Render the start form (amount and start button). False while a payment is in progress or a blocking condition stands.                 |
| `canStart`  | The start button may run: the form shows and nothing stands in the way. A short balance keeps the form so the reader can choose less. |
| `canRetry`  | Pass as `retryAllowed`: the record allows a retry and no condition blocks it.                                                         |

Blocking notices hide the start form: paused, the quick-tip key states, key
and daily limits, no open tab, tab closing and withdrawal pending. Other
notices (short balance, settlement delayed, refusals) sit beside it.

### Progress sources

`TransactionProgress` and `resolvePaymentView` take a `source`:

| Source                                                  | Use                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| `{ record, step?, declined? }`                          | Direct and highlight tips, collect, settle own, mint, transfer  |
| `{ record, rows, step?, declined? }`                    | A basket (`getSubmissionStatus().rows`)                         |
| `{ tabTip: { status } }`                                | A tab tip receipt                                               |
| `{ tabOperation, tab, step?, sent?, poll?, declined? }` | Open tab, top-up, new key, revoke key, close tab, withdraw      |
| `{ clientStep }`                                        | Before prepare returns a record, and a tab tip while it is sent |

### Record status to phase (`phaseFromRecord`)

| Server status                            | Phase                | Notes                                                                            |
| ---------------------------------------- | -------------------- | -------------------------------------------------------------------------------- |
| `PREPARED`, client in a step             | that step            | `simulating`, `signing` or `sending` while the user is in the flow               |
| `PREPARED`, no client step               | `resuming`           | A reload. The client does not know what happened, so no step is shown as done.   |
| `SUBMITTED`                              | `checking`           | The transaction was sent; the step list shows prepare, approve and send as done. |
| `CONFIRMED`                              | `confirmed`          |                                                                                  |
| `MISMATCH`, `mismatchReason: author`     | `sent-to-registered` | Complete. No retry.                                                              |
| `MISMATCH`, `field:*` or `no_event`      | `under-review`       | No retry. The record is flagged for review.                                      |
| `FAILED`                                 | `failed`             | Retry offered.                                                                   |
| `FAILED` or `EXPIRED` with `needsReview` | `under-review`       | An event arrived after the failure: the payment may have landed. No retry.       |
| `EXPIRED`                                | `expired`            | Retry offered, with a new `requestId`.                                           |
| Wallet refusal seen by the client        | `declined`           | While `PREPARED` and after `FAILED` (below).                                     |
| Any other value                          | `resuming`           | `tips.status` also holds v1 values. Safe: no retry, never confirmed.             |

A final server status always wins over a client step.

### Wallet refusal

A wallet refusal follows the server: the flow calls
`chain.submissions.recordSendFailed` with reason `wallet_rejected`, which
moves the record from `PREPARED` to `FAILED` (#495). The client shows
`declined` at once, titled "Request declined in your wallet" with "Nothing was
signed or sent." "Try again" appears only once the record reads `FAILED`, so
the kit never offers a retry the server has not recorded.

Spec 6.1, rule 3 lists three causes of `FAILED` (RPC `FAILED`, send `ERROR`,
simulation failure). The merged server also sets it for `wallet_rejected`.
The kit follows the merged server; the spec text is unchanged here.

### Batches (`phaseFromBatch`)

| Rows                                                     | Phase                                          |
| -------------------------------------------------------- | ---------------------------------------------- |
| Any row under review or `needsReview`                    | `under-review`                                 |
| Every row `CONFIRMED` or `MISMATCH` with reason `author` | `confirmed`, with the count of redirected rows |
| Otherwise                                                | The batch record decides                       |

Basket rows in `AmountSummary` take their own `status` (a
`PaymentStatusLabel`) and a one-line `note`.

### Tab tips (`phaseFromTabTip`)

| Status       | Phase        | Notes                                                 |
| ------------ | ------------ | ----------------------------------------------------- |
| `ACCEPTED`   | `accepted`   | Not final.                                            |
| `SETTLED`    | `settled`    | Pass the settlement hash to link it.                  |
| `SHORTFALL`  | `shortfall`  | Not final: settles after a top-up.                    |
| `UNPAID`     | `unpaid`     | Final. Reader and writer copy differ (`audience`).    |
| `REJECTED`   | `rejected`   | Excluded by the settler; nothing ran on chain for it. |
| `VOID_RESET` | `void-reset` | Testnet reset only.                                   |
| Any other    | `resuming`   |                                                       |

### Tab operations (`phaseFromTabOperation`)

Tab operations have no server record: the indexer applies their events to
the tab account and its keys. They confirm from `tabs.getMyTab`:

| Operation  | Confirmed when                                          |
| ---------- | ------------------------------------------------------- |
| Open tab   | `status` is `OPEN`                                      |
| Top-up     | `confirmedBalance` is above the balance when it started |
| New key    | `keys` holds the key ID, not revoked                    |
| Revoke key | `keys` holds the key ID, revoked                        |
| Close tab  | `status` is `CLOSING`                                   |
| Withdraw   | `status` is `CLOSED`                                    |

Until then: the client step, `checking` once sent, `failed` when RPC reports
`FAILED` (nothing moved), `expired` when polling timed out. Both allow a
retry. The state check runs first, so a late indexer update still turns the
view confirmed.

A failed tab operation shows the tab operation copy below only when the flow
passes no `failure`. When the flow knows why it failed (send refused, Stellar
testnet busy), pass that `failure`; its copy replaces the polling copy.

### Wallet errors (`gateFromWalletError`, `failureFromWalletError`)

| Wallet error kind                                   | Goes to                                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `no-wallet`, `locked`, `wrong-network`              | `WalletGate`                                                                                 |
| `disconnected`                                      | `WalletGate` "Wallet disconnected" (`ended: true`): the wallet ended the connection.         |
| `rejected`                                          | `declined`                                                                                   |
| `timeout`, `wrong-account`, `unsupported`, `failed` | `failed` with the wallet copy below. Titles are fixed; the wallet's own text is never shown. |
| `popup-blocked`                                     | `failed` with its own next step: allow pop-ups, then try again.                              |
| `cancelled`                                         | Back to the start form. Closing the picker is not an error.                                  |

### Contract and send errors (`noticeFromContractFailure`, `failureFromContract`)

A contract code is decoded with the contract that raised it, read from the
simulation's diagnostic events (`lib/stellar/v2/errors.ts`). The Stellar Asset
Contract that moves XLM uses codes 1 to 15, which overlap Core's, so a token
`BalanceError` (#10) is never read as Core `DuplicateClientRef` (#10). When
the raising contract is not one of this deployment's, the failure is generic.

| Decoded failure                                                                    | Shows                                                                             |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `EnforcedPause` (1000) from any contract                                           | Notice: paused                                                                    |
| Token `BalanceError` or `InsufficientAccountReserve`; send `txInsufficientBalance` | Notice: insufficient balance (wallet)                                             |
| Core `NotRegistered` (1)                                                           | Notice: tips unavailable; in a basket, the basket notice                          |
| Tab `KeyNotFound` (35)                                                             | Notice: session key missing                                                       |
| Tab `WithdrawLocked` (41)                                                          | Notice: withdrawal pending                                                        |
| Anything else, or an unknown raising contract                                      | `failed`, titled "Not sent", the decoded message, ending "Nothing was sent." once |

### Transaction outcomes (`viewFromTxOutcome`)

One mapping for every `sendContractCall` outcome: what to show, and what to
send to `recordSendFailed`.

| Outcome                                 | Shows                               | Records                             |
| --------------------------------------- | ----------------------------------- | ----------------------------------- |
| `sent`                                  | Progress; the record decides        | nothing (record the hash)           |
| `wallet_failed`, `rejected`             | `declined`                          | `wallet_rejected`                   |
| `wallet_failed`, `cancelled`            | The start form                      | `wallet_rejected`                   |
| `wallet_failed`, gate kinds             | `WalletGate`                        | `wallet_rejected`                   |
| `wallet_failed`, other kinds            | `failed`, wallet copy               | `wallet_rejected`                   |
| `simulation_failed` or `send_error`     | A notice, or `failed`               | `simulation_failed` or `send_error` |
| `not_sent` (TRY_AGAIN_LATER to the end) | `failed`, "Stellar testnet is busy" | `send_error`                        |

### Convex tab refusals (`refusalFromTabError`)

The tab functions refuse with `ConvexError` codes. Each maps to one state; a
code not listed is a plain refusal with the generic copy. A unit test fails
when the tab functions throw a code this table does not list.

| Code                                                                                                                                               | Shows                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `TAB_OVER_BALANCE`                                                                                                                                 | Notice: insufficient balance (tab)   |
| `TAB_OVER_KEY_LIMIT`, `TAB_RECEIPT_CAP`                                                                                                            | Notice: key limit                    |
| `TAB_DAILY_LIMIT`                                                                                                                                  | Notice: daily limit                  |
| `TAB_KEY_EXPIRED`                                                                                                                                  | Notice: session key expired          |
| `TAB_KEY_UNKNOWN`, `TAB_KEY_REVOKED`, `TAB_PAIR_CLOSED`                                                                                            | Notice: quick tips not set up here   |
| `TAB_NO_ACCOUNT`, `TAB_CLOSED`                                                                                                                     | Notice: no open tab                  |
| `TAB_CLOSING`                                                                                                                                      | Notice: tab closing                  |
| `TAB_READER_UNVERIFIED`                                                                                                                            | Gate: unverified                     |
| `TAB_ARTICLE_HAS_SPLITS`                                                                                                                           | Tips unavailable: `splits`           |
| `TAB_ARTICLE_NOT_REGISTERED`, `TAB_ARTICLE_UNKNOWN`                                                                                                | Tips unavailable: `unregistered`     |
| `TAB_WRITER_UNVERIFIED`                                                                                                                            | Tips unavailable: `payout_outdated`  |
| `TAB_ABOVE_TIP_MAX`                                                                                                                                | Refused: above the quick-tip maximum |
| `TAB_BELOW_MINIMUM`, `TAB_INVALID_AMOUNT`                                                                                                          | Refused: below the minimum           |
| `TAB_SELF_TIP`                                                                                                                                     | Refused: own article                 |
| `TAB_PRICE_UNAVAILABLE`                                                                                                                            | Refused: no XLM price                |
| `TAB_PREPARE_EXPIRED`, `TAB_PREPARE_NOT_FOUND`, `TAB_STALE_PREPARE`                                                                                | Refused: took too long               |
| `TAB_DUPLICATE_REFERENCE`                                                                                                                          | Refused: already sent                |
| `TAB_NO_WITHDRAWAL`                                                                                                                                | Refused: no withdrawal waiting       |
| `TAB_ACCOUNT_OTHER_USER`                                                                                                                           | Refused: tab of another account      |
| `TAB_INVALID_SIGNATURE`, `TAB_RECEIPT_MISMATCH`                                                                                                    | Refused: voucher not accepted        |
| `TAB_ACCEPTOR_UNAVAILABLE`, `TAB_CHAIN_STATE_UNKNOWN`, `TAB_ACCEPTOR_MISMATCH`, `TAB_CONTRACT_MISMATCH`, `TAB_EPOCH_CURRENT`, `TAB_CONFIG_INVALID` | Refused: quick tips unavailable      |

## State definitions

Each column of the matrix below is one of these states. The copy is exact.
"Announced" is what assistive technology reads when the state appears after
the page has loaded. A state already there when the page loads is read with
the page and not announced.

### Wallet gate

The gate wraps the content that needs a wallet and renders it only when the
state is `ready`. It belongs inside the tip dialog or the tab page, after the
reader chooses to pay, never around the tip button on the article page. Its
action button keeps the same DOM node from one blocked state to the next, so
focus stays on it. When the gate opens after the user acted in it, focus
moves to the first control of the content (for example "Send tip"). While the
wallet prompt is open (`busy`), the button reads "Waiting for your wallet…",
is `aria-disabled`, keeps focus, and its spinner takes the button's text
colour.

| State               | Title                         | Detail                                                                                                                                           | Action         | Tone    |
| ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------- |
| Checking            | Checking your wallet          | This takes a moment.                                                                                                                             | none (spinner) | inline  |
| Signed out          | Sign in to continue           | Tips and tabs belong to your QuillTip account.                                                                                                   | Sign in        | neutral |
| No wallet           | No Stellar wallet found       | Install a Stellar wallet such as Varial (formerly Freighter) or xBull in this browser, then try again.                                           | Set up wallet  | neutral |
| Not connected       | Connect your wallet           | Connecting shares your address. It does not send a payment.                                                                                      | Connect wallet | neutral |
| Wallet disconnected | Your wallet disconnected      | Your wallet ended the connection. Connect again to continue. Nothing was sent.                                                                   | Connect again  | neutral |
| Locked wallet       | Your wallet is locked         | Unlock your wallet, then connect again.                                                                                                          | Connect again  | warning |
| Wrong network       | Switch your wallet to Testnet | Your wallet is on {network}, for example: Your wallet is on Mainnet. Switch it to Testnet, then check again. Nothing was sent.                   | Check again    | warning |
| Unverified address  | Confirm this wallet is yours  | Sign a short message in your wallet to link it to your account. It sends nothing and costs nothing. ("it" becomes the short address when known.) | Confirm wallet | neutral |

Announced: "{title}. {detail}" through a polite live region that stays
mounted, once per change. Addresses show as "GBZX…MADI", with the full address
in the tooltip.

"Connect wallet" and "Sign in" are sentence case inside payment prompts; the
launch copy guide lists them.

### Progress

Wallet-signed flows show four steps: **Prepare**, **Approve in wallet**,
**Send**, **Confirm**. Done steps show a tick, the current step a turning ring,
later steps a hollow dot. One sentence under the list says what is happening.
A visually hidden heading, "Payment progress", sits at the top.

| Phase                          | Sentence (shown and announced politely)                                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simulating                     | Checking the details…                                                                                                                                                         |
| Waiting for wallet (`signing`) | Approve the request in your wallet. It shows the network fee.                                                                                                                 |
| Sending                        | Sending…                                                                                                                                                                      |
| Checking                       | Waiting for confirmation. You can close this. The result shows in {place}. Default place: Waiting for confirmation. You can close this. The result shows in your tip history. |
| Checking, `slow`               | **Still checking.** Stellar testnet is slow right now. If the payment went through, it shows here, and it cannot be charged twice.                                            |
| Resuming                       | Checking whether this payment went through. This can take up to 5 minutes. (one line, no step list)                                                                           |
| Tab tip, sending               | Sending your tip… (one line, no step list: a tab tip has no wallet prompt)                                                                                                    |

While signing, the view adds the line below and, when the flow passes `onCancel`, a "Cancel" button. Cancel
is client only: nothing was signed.

| While signing                                      |
| -------------------------------------------------- |
| Don’t see the request? Open your wallet extension. |

Set `slow` once the client has polled past `maxTime + 30 s` with no answer.
Set `resultPlace` to where the result shows later, for example "your tab".
"View the transaction" appears once a hash exists, with the testnet label.

### Results

| Phase                                 | Title                                               | Detail                                                                                                                                                                   | Action              | Tone    | Announced |
| ------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ------- | --------- |
| Confirmed                             | per flow (below)                                    | per flow (below)                                                                                                                                                         | Done (`doneAction`) | success | polite    |
| Sent to the registered payout address | Tip sent to the article’s registered payout address | Stellar testnet paid the address registered for this article, which differs from the one shown when you started. The tip is complete, so there is nothing to retry.      | none                | info    | polite    |
| Under review                          | Sent, but under review                              | The payment went through on Stellar testnet, but the details did not match what QuillTip expected. Your XLM may have moved, so do not send it again. We are checking it. | Get help            | warning | polite    |
| Failed                                | Not completed (or the client's failure title)       | QuillTip recorded no payment for this request. (or the client's failure detail)                                                                                          | Try again           | danger  | assertive |
| Declined                              | Request declined in your wallet                     | Nothing was signed or sent.                                                                                                                                              | Try again           | warning | assertive |
| Expired                               | This request timed out                              | Stellar testnet did not include it in time, so nothing was paid. Try again to start a new request.                                                                       | Try again           | warning | assertive |
| Tab tip accepted                      | Tip sent from your tab                              | It settles on Stellar testnet within about 6 hours. Your tab balance already counts it.                                                                                  | none                | info    | polite    |
| Tab tip shortfall                     | Waiting for the tab balance                         | This tip is recorded, but the tab ran short. It settles after the next top-up.                                                                                           | none                | warning | polite    |
| Tab tip unpaid, reader                | Not paid                                            | This tip was not settled before its quick-tip key ran out, so it was not paid. The amount is back in your tab balance.                                                   | none                | danger  | polite    |
| Tab tip unpaid, writer                | Not paid                                            | This tip was not settled in time, so it will not be paid.                                                                                                                | none                | danger  | polite    |
| Tab tip rejected, reader              | Not settled                                         | QuillTip could not settle this tip, so it was not paid and your tab was not charged for it. We are checking it.                                                          | Get help            | warning | polite    |
| Tab tip rejected, writer              | Not settled                                         | QuillTip could not settle this tip, so it was not paid to you. We are checking it.                                                                                       | Get help            | warning | polite    |
| Tab tip void reset                    | Cleared by a testnet reset                          | Stellar testnet was reset before this tip settled. No real money was involved.                                                                                           | none                | neutral | polite    |

Every result can lead with a summary line, "{amount} to {recipient}" (for
example "1 XLM to Ada Lovelace"), from `summary`. The testnet label sits on
the same line, and on any result with a transaction link. Under review and
rejected results can show the record as "Reference: {id}" and a "Get help"
link (`reference`, `helpHref`). "Done" is the default label of `doneAction`,
shown when there is no retry. "Try again" is the retry label.

"View the transaction" appears only for phases with a transaction of their
own: checking, confirmed, sent to the registered address, under review,
failed, expired, and a settled tab tip with its settlement hash. Accepted,
shortfall, unpaid, rejected and void reset tab tips have no link.

Announced text is "{title}. {detail}". When a result arrives after mount and
focus would be lost (the button that started the payment is gone, or focus is
already inside the progress view), focus moves to the result title. A result
present on page load takes no focus and plays no animation.

Confirmed copy per flow:

| Flow                | Title                              | Detail                                                                            |
| ------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| Direct tip          | Tip confirmed                      | Your tip is recorded on Stellar testnet.                                          |
| Highlight tip       | Highlight tip confirmed            | Your tip for this passage is recorded on Stellar testnet.                         |
| Tip basket          | Tips confirmed                     | Every tip in your basket is recorded on Stellar testnet.                          |
| Open tab            | Your tab is open                   | Tip from it on this device without a wallet prompt.                               |
| Top-up              | Top-up confirmed                   | Your tab balance is updated.                                                      |
| Tab tip (`settled`) | Tip settled                        | Your tip is paid out on Stellar testnet.                                          |
| New key             | Quick tips are on for this device  | This browser can tip from your tab without a wallet prompt.                       |
| Revoke key          | Quick tips are off for this device | This browser can no longer tip from your tab. Tips you already sent still settle. |
| Close tab (start)   | Withdrawal started                 | Your balance unlocks after about 3 days. Tips you already sent settle first.      |
| Withdraw            | Withdrawal complete                | Your tab balance is back in your wallet.                                          |
| Collect             | Earnings collected                 | They are in your wallet now.                                                      |
| Settle own voucher  | Voucher settled                    | These tips are paid. Collect them to move them to your wallet.                    |
| Mint                | Article NFT minted                 | The NFT is in your wallet on Stellar testnet.                                     |
| Transfer            | NFT transferred                    | The new owner holds it now.                                                       |

Variants:

| Case                                 | Detail                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Basket, one row redirected           | Your tips are recorded on Stellar testnet. One went to the article’s updated payout address.     |
| Basket, more than one row redirected | Your tips are recorded on Stellar testnet. {n} went to their articles’ updated payout addresses. |
| Close tab, unlock date known         | Your balance unlocks around {date}. Tips you already sent settle first.                          |

### Failure copy

Wallet failures while signing, with fixed titles. Every wallet error kind
except `cancelled` has a row; a unit test fails to compile when a new kind
has none.

| Kind            | Title                                   | Detail                                                                               |
| --------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| `rejected`      | Request declined in your wallet         | Nothing was signed or sent.                                                          |
| `timeout`       | Your wallet did not respond             | Check for an open wallet window, close it, then try again. Nothing was sent.         |
| `unsupported`   | This wallet cannot be used here         | Choose another wallet in the wallet list. Nothing was sent.                          |
| `wrong-account` | Your wallet signed with another account | Switch back to the connected account in your wallet, or reconnect. Nothing was sent. |
| `popup-blocked` | Your browser blocked the wallet window  | Allow pop-ups for this site in your browser, then try again. Nothing was sent.       |
| `disconnected`  | Your wallet disconnected                | Your wallet ended the connection. Connect again, then try again. Nothing was sent.   |
| `no-wallet`     | No Stellar wallet found                 | Install a Stellar wallet, then try again. Nothing was sent.                          |
| `locked`        | Your wallet is locked                   | Unlock your wallet, then connect again. Nothing was sent.                            |
| `wrong-network` | Switch your wallet to Testnet           | Switch it to Testnet, then try again. Nothing was sent.                              |
| `failed`        | Your wallet reported a problem          | Try again, or reconnect your wallet. Nothing was sent.                               |

Send and contract failures: "Not sent" with "Nothing was sent.", or for
`not_sent`, "Stellar testnet is busy" with "Stellar testnet did not accept it.
Try again in a minute."

A tab operation that failed or timed out is known only from the client's own
RPC polling, so its copy names no money:

| Phase   | Title                  | Detail                                                                                   |
| ------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| Failed  | Not completed          | Stellar testnet reported this transaction as failed. Your tab shows its current balance. |
| Expired | This request timed out | Stellar testnet did not confirm it in time. Check your tab before you try again.         |

Convex tab refusals with no notice of their own (`kind="refused"`):

| Refusal                | Title                                        | Detail                                                         |
| ---------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| Above the maximum      | This tip is above the quick-tip maximum      | Choose a smaller amount, or tip from your wallet.              |
| Below the minimum      | This tip is below the minimum                | Choose a larger amount.                                        |
| Own article            | You can’t tip your own article               | This tip was not accepted.                                     |
| No price               | No XLM price right now                       | QuillTip can’t convert this amount yet. Try again in a minute. |
| Took too long          | This tip took too long                       | This tip was not accepted. Send it again.                      |
| Already sent           | This tip was already sent                    | Your tab already counts it.                                    |
| No withdrawal          | No withdrawal is waiting                     | Close your tab first to start one.                             |
| Quick tips unavailable | Quick tips are unavailable right now         | Tip from your wallet, or try again later.                      |
| Another account        | This wallet’s tab belongs to another account | Sign in to the account that opened it, or use another wallet.  |
| Voucher not accepted   | QuillTip could not accept this tip           | Set up quick tips again on this device.                        |
| Any other code         | QuillTip could not accept this               | Try again in a minute.                                         |

### Notices

Notices describe a standing condition, not a step. Each renders a polite live
region that is mounted empty. Pass `announce` when the notice appears because
of something the user just did; it is then read once. Without `announce` (a
condition there when the page loads) it is not announced.

| Notice                       | Title                                                                                     | Detail                                                                                                                                                                                           | Action (default label)  | Emphasis  | Tone    |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | --------- | ------- |
| Paused, reader               | Payments are paused                                                                       | QuillTip has paused new payments on Stellar testnet. Tips you already sent still settle, and you can still withdraw your tab.                                                                    | none                    |           | warning |
| Paused, writer               | Payments are paused                                                                       | QuillTip has paused new payments on Stellar testnet. Tips already sent still settle, and you can still collect.                                                                                  | none                    |           | warning |
| Insufficient balance, wallet | Not enough XLM in your wallet                                                             | This needs {needed} plus a small network fee. Your wallet can spend {available}. Without amounts: Add test XLM to your wallet or choose a smaller amount. The network fee is small but not zero. | Choose a smaller amount | secondary | warning |
| Insufficient balance, tab    | Not enough in your tab                                                                    | Your tab has {available} free after tips still settling. Top up or choose a smaller tip. Without an amount: Top up your tab or choose a smaller tip.                                             | Top up                  | primary   | warning |
| Quick tips not set up here   | Quick tips aren’t set up on this device                                                   | Your tab is open. Set up quick tips here to tip without a wallet prompt. It takes one wallet approval.                                                                                           | Set up quick tips       | primary   | info    |
| Session key missing          | This device’s quick-tip key is gone                                                       | Your browser cleared it. Your balance is safe, and tips you already sent still settle. Set up quick tips again to keep tipping from your tab.                                                    | Set up quick tips       | primary   | info    |
| Session key expired          | Quick tips on this device have expired                                                    | Your balance is safe, and tips you already sent still settle. Renewing takes one wallet approval.                                                                                                | Renew quick tips        | primary   | info    |
| Key limit                    | This device reached its quick-tip limit                                                   | Set up quick tips again to raise it, or tip from your wallet.                                                                                                                                    | Set up quick tips       | secondary | info    |
| Daily limit                  | Daily quick-tip limit reached                                                             | Tip from your wallet, or try again tomorrow.                                                                                                                                                     | Tip from wallet         | secondary | info    |
| No open tab                  | You don’t have an open tab                                                                | Open a tab to tip without a wallet prompt, or tip from your wallet.                                                                                                                              | Open a tab              | secondary | info    |
| Tab closing                  | Your tab is closing                                                                       | Quick tips are off until you add funds or the withdrawal finishes. Tip from your wallet instead.                                                                                                 | Tip from wallet         | secondary | info    |
| Settlement delayed, reader   | Settlement is taking longer than usual                                                    | Your tips are recorded and will settle. Nothing is lost.                                                                                                                                         | none                    |           | info    |
| Settlement delayed, writer   | Settlement is taking longer than usual                                                    | These tips are recorded and will settle. You can also settle them yourself with your saved voucher.                                                                                              | Settle it yourself      | secondary | info    |
| Basket item unavailable      | An article in your basket can’t take tips right now                                       | Remove it to send the rest. Nothing was sent.                                                                                                                                                    | Remove it               | secondary | warning |
| Withdrawal pending           | Your balance unlocks around {date} (without a date: Your withdrawal is waiting to unlock) | Your tab is closing. Tips you already sent settle first, and quick tips are off. Adding funds before then cancels the withdrawal.                                                                | none                    |           | info    |
| Withdrawal ready             | Your balance is ready to withdraw                                                         | The waiting period is over. Withdraw to move it to your wallet.                                                                                                                                  | Withdraw {amount}       | primary   | success |
| Before closing the tab       | Before you close your tab                                                                 | Closing locks your tab balance for about 3 days. Tips you already sent settle first. Adding funds before then cancels it.                                                                        | the flow's "Close tab"  | secondary | info    |
| NFT threshold                | {tipped} of {threshold} tipped                                                            | Minting unlocks at {threshold}.                                                                                                                                                                  | none                    |           | neutral |
| Network busy                 | Stellar testnet is busy                                                                   | Stellar testnet did not accept it. Try again in a minute.                                                                                                                                        | none                    |           | warning |
| Refused                      | per refusal (above)                                                                       | per refusal (above)                                                                                                                                                                              | none                    |           | warning |

A notice that shows an amount (insufficient balance with amounts, withdrawal
ready, NFT threshold) carries the testnet label.

Tips unavailable is a one-line note in place of the tip button, rendered by
`TipsUnavailableNote`:

| Reason            | Copy                                                                                                         | Action          |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | --------------- |
| `unregistered`    | Tips aren’t on for this article yet.                                                                         | none            |
| `pending`         | Tips for this article turn on in a moment.                                                                   | none            |
| `payout_outdated` | Tips are paused while the writer updates their wallet.                                                       | none            |
| `paused`          | Tips are paused for a short time while payments are updated.                                                 | none            |
| `splits`          | Quick tips don’t work for this article because it shares tips with co-authors. Tip from your wallet instead. | Tip from wallet |

When to show:

- **Paused:** `chainConfig.paused`, or a simulation error `EnforcedPause`. Only
  for actions the pause blocks: tips, batches, deposits, opening a tab, new
  keys, mints and transfers. Never for collect, settle own, revoke key, close
  tab or withdraw (I-27). Pass `audience="writer"` on writer surfaces.
- **Session key expired:** from one day before `valid_until`, when Convex stops
  accepting the key ([section 3.5](../architecture/v2/03-tab-contract.md#35-session-keys)).
- **Quick tips not set up here:** the tab is open and this browser holds no
  key (a second device), or Convex reports `TAB_KEY_UNKNOWN` or
  `TAB_KEY_REVOKED`. **Session key missing** is for a key this browser had
  and lost, or the Tab contract's `KeyNotFound`.
- **Settlement delayed:** `isSettlementDelayed(oldestAcceptedAt, now)`, true
  when the oldest accepted, unsettled tab tip is older than 8 hours. A small
  pair is due at 6 hours and the settler runs every 10 minutes
  ([section 3.8](../architecture/v2/03-tab-contract.md#38-settlement-policy-convex-settler)),
  so 8 hours leaves room for two runs and the transaction.
- **Withdrawal pending:** the date comes from
  `formatDay(estimateLedgerTime(withdrawUnlockLedger, latest))`; ledger times
  vary, so the copy says "around".
- **Before closing the tab:** beside the "Close tab" action, before the reader
  commits.
- **NFT threshold:** below the mint threshold, in place of the missing mint
  button ([section 5.10](../architecture/v2/05-flows-and-admin.md#510-nft-mint-and-transfer)).
- **Network busy:** RPC timeouts or a failed `getHealth`.

### Quick-tip keys

`SessionKeyRow` shows one key from `getMyTab().keys`: the device label
(default "Quick tips on this device"), "Expires around {date}" (or "Expired",
"Revoked"), "{used} of {limit} used" from `acceptedTotal` and `spendLimit`,
the testnet label, and the actions "Revoke" and, once expired, "Renew quick tips". Revoke needs
one wallet approval and stays open under a pause.

### History status labels

`PaymentStatusLabel` shows one word or phrase with a coloured dot that repeats
the meaning; the text alone carries it. It never wraps.

| Phase                        | Label                   |
| ---------------------------- | ----------------------- |
| simulating, signing, sending | In progress             |
| checking                     | Confirming              |
| resuming                     | Checking                |
| declined                     | Declined                |
| confirmed                    | Confirmed               |
| sent-to-registered           | Sent to updated address |
| under-review                 | Under review            |
| failed                       | Not completed           |
| expired                      | Timed out               |
| accepted                     | Settling                |
| settled                      | Settled                 |
| shortfall                    | Waiting for balance     |
| unpaid                       | Not paid                |
| rejected                     | Not settled             |
| void-reset                   | Cleared by reset        |

## State matrix

Key: **●** applies with the copy above. A number points to a note below the
table. **–** does not apply.

| Flow               | No wallet | Locked | Wrong network | Unverified | Insufficient balance | Simulating | Waiting for wallet | Sending | Checking | Confirmed | Sent to registered address | Failed, retry | Expired, retry | Paused | Session key expired or missing | Settlement delayed | Tips unavailable |
| ------------------ | :-------: | :----: | :-----------: | :--------: | :------------------: | :--------: | :----------------: | :-----: | :------: | :-------: | :------------------------: | :-----------: | :------------: | :----: | :----------------------------: | :----------------: | :--------------: |
| Direct tip         |     ●     |   ●    |       ●       |    ● 1     |       ● wallet       |     ●      |         ●          |    ●    |    ●     |     ●     |             ●              |       ●       |       ●        |   ●    |               –                |         –          |       ● 2        |
| Highlight tip      |     ●     |   ●    |       ●       |    ● 1     |       ● wallet       |     ●      |         ●          |    ●    |    ●     |     ●     |             ●              |       ●       |       ●        |   ●    |               –                |         –          |       ● 2        |
| Tip basket         |     ●     |   ●    |       ●       |    ● 1     |       ● wallet       |     ●      |         ●          |    ●    |    ●     |    ● 3    |            ● 3             |      ● 3      |       ●        |   ●    |               –                |         –          |       ● 4        |
| Open tab           |     ●     |   ●    |       ●       |    ● 1     |       ● wallet       |     ●      |         ●          |    ●    |   ● 5    |    ● 5    |             –              |      ● 5      |      ● 5       |   ●    |               –                |         –          |        –         |
| Top-up             |     ●     |   ●    |       ●       |    ● 1     |       ● wallet       |     ●      |         ●          |    ●    |   ● 5    |   ● 5 6   |             –              |      ● 5      |      ● 5       |   ●    |               –                |         –          |        –         |
| Tab tip            |    – 7    |  – 7   |      – 7      |    – 7     |       ● tab 8        |     –      |         –          |   ● 9   |    –     |   ● 10    |             –              |     ● 11      |       –        |  ● 12  |              ● 8               |      ● reader      |       ● 2        |
| New key            |     ●     |   ●    |       ●       |    ● 1     |     ● wallet 13      |     ●      |         ●          |    ●    |   ● 5    |    ● 5    |             –              |      ● 5      |      ● 5       |   ●    |              ● 14              |         –          |        –         |
| Revoke key         |     ●     |   ●    |       ●       |    ● 1     |     ● wallet 13      |     ●      |         ●          |    ●    |   ● 5    |    ● 5    |             –              |      ● 5      |      ● 5       |   –    |               –                |         –          |        –         |
| Close tab (start)  |     ●     |   ●    |       ●       |    ● 1     |     ● wallet 13      |     ●      |         ●          |    ●    |   ● 5    |  ● 5 15   |             –              |      ● 5      |      ● 5       |   –    |               –                |      ● reader      |        –         |
| Withdraw           |     ●     |   ●    |       ●       |    ● 1     |     ● wallet 13      |     ●      |         ●          |    ●    |   ● 5    |    ● 5    |             –              |      ● 5      |      ● 5       |   –    |               –                |         –          |        –         |
| Collect            |     ●     |   ●    |       ●       |    ● 16    |     ● wallet 13      |     ●      |         ●          |    ●    |    ●     |     ●     |             –              |       ●       |       ●        |   –    |               –                |      ● writer      |        –         |
| Settle own voucher |     ●     |   ●    |       ●       |    ● 16    |     ● wallet 13      |     ●      |         ●          |    ●    |    ●     |     ●     |             –              |       ●       |       ●        |   –    |               –                |    ● writer 17     |        –         |
| Mint               |     ●     |   ●    |       ●       |    ● 16    |     ● wallet 13      |     ●      |         ●          |    ●    |    ●     |     ●     |             –              |       ●       |       ●        |   ●    |               –                |         –          |       – 18       |
| Transfer           |     ●     |   ●    |       ●       |    ● 1     |     ● wallet 13      |     ●      |         ●          |    ●    |    ●     |     ●     |             –              |       ●       |       ●        |   ●    |               –                |         –          |        –         |

Every wallet-signed flow can also show `declined` (a wallet refusal) and
`resuming` (a reload while the record is `PREPARED`).

Notes:

1. The reader's linked address must be proven ("Confirm this wallet is
   yours"). Prepare refuses a wallet that is not linked to the account.
2. Shown instead of the tip button, with the reason Convex reports. `splits`
   applies to tab tips only and offers "Tip from wallet".
3. A batch is atomic: every row confirms or fails together. Each row is still
   verified on its own, so one row can be `sent-to-registered` while the rest
   are `confirmed`. `phaseFromBatch` gives the overall phase and the count for
   the basket copy; show a `PaymentStatusLabel` per row through `items`.
4. Items whose article cannot take tips get their one-line `note` and are
   removed before prepare. A Core `NotRegistered` during a basket shows the
   basket notice.
5. No server record: the indexed tab state confirms (`phaseFromTabOperation`).
   RPC `FAILED` is `failed`, a poll timeout is `expired`; both allow a retry.
6. A deposit during a pending withdrawal cancels it. When the account was
   closing, add `resultDetail`: "Your withdrawal was cancelled because you
   added funds." (flow copy, owned by the tab session).
7. A tab tip needs no wallet prompt. The reader must be signed in and have an
   open tab with a usable key on this device; otherwise show the tab setup or
   the key notice.
8. From `refusalFromTabError`: balance, key, key limit, daily limit, no tab
   and tab closing each have a notice.
9. One line, "Sending your tip…", while `submitTip` runs (`{ clientStep: 'sending' }`).
10. `accepted` first ("Tip sent from your tab"), `settled` later. `shortfall`,
    `unpaid`, `rejected` and `void-reset` follow the result table.
11. A refused submission (balance, limit or key changed) retries once
    automatically from prepare, as the flow requires. If it still fails, show
    the refusal.
12. Only if Convex refuses tab tips while Core is paused. Settlement itself is
    never paused.
13. These flows move no XLM from the wallet beyond the network fee, so the
    insufficient-balance notice uses its no-amount copy.
14. The new-key flow is the action behind the session-key notices.
15. Pass `unlocksAround`, and show the withdrawal-pending notice with the
    same date. Show the before-closing notice beside "Close tab" first.
16. A writer's receiving wallet must be verified; use `verifyHref` to the
    dashboard wallet page.
17. Settle own is the action behind the writer's settlement-delayed notice.
18. The mint action appears only when the article has reached the threshold.
    Below it, show the NFT threshold notice.

## Amounts

- **Primary:** XLM from base units, through `formatXlm` (`formatXlmFromStroops`).
  Full stroop precision, grouped thousands, no trailing zeros: `0.975 XLM`,
  `0.0000039 XLM`, `12,345,678,901.2345678 XLM`. Invalid input shows "–", never
  a wrong number. Inline amounts use `XlmAmount`, which keeps the unit on the
  same line.
- **Secondary:** the cents quote, when the caller has one, after the testnet
  label: "About {usd} in real XLM", for example "About $0.12 in real XLM", or
  "Under $0.01 in real XLM". It says what the same amount of real XLM is
  worth; it is not the amount paid.
- **Estimates:** before prepare returns, the XLM figure is a conversion from
  the chosen cents. Pass `estimate`: every figure reads "About …" and the
  caption adds "Final amount shown before you approve". `coreTipSplit`
  mirrors the Core rule for that preview only: the fee is
  `floor(gross × 250 / 10,000)` and the author side gets the remainder (I-1).
  A 40-stroop tip splits 39 and 1.
- **Breakdown:** pass the author share and the platform fee as values from
  Convex (the prepare response) or the `Tipped` event, labelled "To the
  author" and "Platform fee". The 97.5% belongs in the trust section, not in
  every dialog.
- **Co-author splits:** one breakdown row per recipient, in the registered
  order, then the platform fee.
- **Wallet balance:** pass what the wallet can spend (balance minus the
  account reserve) as `available`.
- Figures use tabular numerals. Long amounts wrap below their label rather
  than overflow.

## Testnet labelling

- Every amount and every transaction link carries `TestnetLabel` ("Stellar
  testnet"): `AmountSummary` always, a result with a summary or a link, the
  checking step with a link, and notices that show an amount.
  `TestnetLabel detail` adds "Practice funds only" where a reader first meets
  an amount, such as the first tip dialog step.
- Step sentences do not repeat the network ("Sending…"); result details name
  it where a payment is recorded.
- Amounts read "XLM", not "test XLM": the label beside them carries the
  network.
- The copy is testnet-only by design while the network guard refuses mainnet.
  A mainnet launch is a reviewed copy change, not a flag.

## Motion

| What                                | How                                                                                     | Reduced motion   |
| ----------------------------------- | --------------------------------------------------------------------------------------- | ---------------- |
| Result reached after mount          | Rises in once: opacity 0 to 1 and 4 px upward, 220 ms, `cubic-bezier(0.32, 0.72, 0, 1)` | none             |
| Confirmed or settled tick           | The tick draws in, 200 ms after an 80 ms delay, ease-out, ending with the rise          | drawn at once    |
| Current step and spinners           | Ring turns, 0.9 s per turn, linear                                                      | static open ring |
| Button press                        | Scales to 0.97, 150 ms ease-out                                                         | none             |
| Step changes, gate changes, notices | No animation. Text and markers swap in place.                                           | n/a              |

There is one authored moment, the confirmation. Nothing animates on page load,
and nothing animates layout properties. The kit's own reduced-motion rules
apply on every surface, not only inside the tip dialog.

## Accessibility

- Live regions are mounted empty and only changes after mount are announced.
  Progress uses a polite region for steps and good news, and an assertive one
  for failed, declined and expired. A client step present at mount (the user
  just pressed the start button) is announced after a short delay.
- Focus never moves when a page or panel first renders. The one exception is
  a progress view the flow mounts in response to the start button, marked
  `startedByUser`. Focus: when a payment starts or restarts and focus would fall to the page,
  it moves to the hidden "Payment progress" heading, which reads the current
  sentence as its description. When a result arrives, focus moves to its
  title the same way. A focused heading is not also announced.
- The step list is an ordered list labelled "Progress"; the current step has
  `aria-current="step"` and done steps read "(done)".
- Result titles are headings (level 3 by default, `headingLevel` to change).
- Every action is a real button or link, at least 44 px high, with a visible
  focus ring in the surface's ring colour. Explorer links say they open a new
  tab. The one next step on a notice is a primary button.
- Icons are decorative (`aria-hidden`); the title always says the state in
  words. Colour never carries meaning alone.
- Inside the tip dialog, which is always light, the kit pins the light status
  colours so dark mode does not lower contrast.
- The dashboard surface and its dialogs are also always light. They carry
  `ui-light` (`app/shared-ui.css`), which sets the light `--ui-*` tokens and
  the aliases built on them again, so the kit and everything else on the
  dashboard look the same in both appearances. A kit action that is a link
  keeps its button colours there (`.pay-action` is left out of the dashboard
  link colour). A new always-light surface takes the same class.
- `e2e/payment-states.spec.ts` checks every state at 375, 768 and 1440 px
  with axe (WCAG 2.2 AA tags), no horizontal overflow, the testnet label on
  every amount and link, keyboard order, focus while running and after a
  result, empty live regions on load, live-region text, reduced motion on the
  dialog and on a page surface, long amounts and errors, reflow at 640 px
  (200 % zoom of 1280) and 320 px, text-spacing overrides, and dark mode.
  On the dashboard surface, every state must render with the same colours in
  dark appearance as in light, and pass the contrast scan in both; a contrast
  axe cannot decide also fails. `e2e/tab-ui.spec.ts` and
  `e2e/wallet-verification.spec.ts` check the tab and wallet pages the same
  way (`e2e/helpers/lightSurface.ts`).

## Using the kit in a flow

1. Load the kit with `import()` when the reader opens the payment surface.
2. Build `WalletGateState` from the wallet adapter and the account: signed in,
   connected, network, and whether the address is verified. The gate goes
   inside the dialog or the tab page, around the payment's primary action.
3. Call `resolvePaymentView({ source, gate, notice, tipsUnavailable })` on
   every render. Render `progress` with `TransactionProgress` whenever it is
   set, `condition` above it or in place of the start form, and the start
   form when `showStart` is true. Pass `canRetry` as `retryAllowed`.
4. Show `AmountSummary` with `estimate` until prepare returns, then with the
   values from the prepare response.
5. Pass `startedByUser` when the progress view mounts because the reader
   pressed the start button, never when it renders with the page.
6. Pass the record as the `source`, with the live `step` from
   `sendContractCall`'s `onStep` while the record is `PREPARED`. For tab
   operations, pass the operation, `getMyTab()` and the client's send and
   poll results.
7. Map each `sendContractCall` outcome with `viewFromTxOutcome`: show what it
   says and send its `record` to `recordSendFailed`. Map `ConvexError` codes
   from the tab functions with `refusalFromTabError`.
8. On "Try again", start a new prepare with a new `requestId`; never resend
   the old envelope.
9. Use `PaymentStatusLabel` with `phaseFromRecord` or `phaseFromTabTip` in
   history rows.

The fixture page shows each state by id:
`http://127.0.0.1:4180/?state=result-failed`. Add `&theme=dark` for the dark
palette and `&surface=dashboard` to show the state on the dashboard surface.
