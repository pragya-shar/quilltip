# Payment states

Every payments v2 flow (tips, the tab, collecting, the article NFT) shows the
same small set of states: something stands between the reader and the wallet,
a transaction is on its way, the server has an answer, or a standing condition
blocks the action. This document defines those states, their copy, and the
shared components in `components/payments/` that render them.

- Components: `components/payments/` (presentational, no Convex or wallet imports).
- Status mapping: `lib/payments/ui-state.ts`. Amounts: `lib/payments/format.ts`.
- Copy: `lib/copy/payment-states.ts`. A unit test fails when a string there is
  missing from this document.
- Fixture with every state: `e2e/fixtures/payments/` (port 4180), tested by
  `e2e/payment-states.spec.ts`.
- Lifecycle rules: [section 6.1](../architecture/v2/06-app-integration.md#61-transaction-lifecycle).
  Edge cases: [section 7.3](../architecture/v2/07-security-and-recovery.md#73-edge-cases).

## Rules

1. **The server decides.** A payment shows as confirmed only when Convex
   reports `CONFIRMED` (or a tab tip `SETTLED`). Client polling only moves the
   progress view to "Confirm".
2. **Retry only after `FAILED` or `EXPIRED`.** Never after `MISMATCH`: money
   may have moved. `TransactionProgress` renders "Try again" only for those
   two phases, even when the caller passes `onRetry`.
3. **Every failure says whether anything was paid.** "Nothing was paid." is
   part of the `failed` and `expired` copy.
4. **Amounts are chain values.** The kit formats base units it is given. It
   never multiplies a preset by 0.975.
5. **Testnet is named once per surface,** next to the amount or the heading,
   never as a banner.
6. **One message at a time.** A surface shows at most one gate prompt, one
   progress view and one notice. The order of precedence is: tips unavailable,
   paused, gate, insufficient balance, progress.

## Components

| Component             | Renders                                                                                                                               | Key props                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `WalletGate`          | The prompt for signed out, no wallet, not connected, locked, wrong network, unverified                                                | `state: WalletGateState`, `onSignIn`, `onInstall`, `onConnect`, `onRecheck`, `onVerify` or `verifyHref`, `busy` |
| `TransactionProgress` | Steps (check, approve, send, confirm), then the result panel                                                                          | `flow`, `phase`, `txHash`, `onRetry`, `failure`, `slow`, `resultDetail`                                         |
| `AmountSummary`       | Total in XLM, testnet label, cents quote, breakdown and basket lines                                                                  | `total`, `breakdown`, `items`, `quoteCents`, `label` (all amounts in stroops)                                   |
| `PaymentNotice`       | Paused, insufficient balance, key missing or expired, settlement delayed, tips unavailable, withdrawal pending or ready, network busy | `kind` plus kind-specific fields; `action` (`onClick` or `href`, optional `label`)                              |
| `PaymentStatusLabel`  | One status in a history row, for example "Settling"                                                                                   | `phase`                                                                                                         |
| `TestnetLabel`        | "Stellar testnet", optionally with "Practice funds, no real value"                                                                    | `detail`                                                                                                        |
| `ExplorerLink`        | "View the transaction" on stellar.expert (testnet), new tab                                                                           | `hash`                                                                                                          |

`PaymentPanel`, `TransactionSteps`, `PaymentSpinner` and `NoticeActionButton`
are internal building blocks. Every message uses `PaymentPanel`: a tinted
surface, a full hairline border, a leading icon, a title, a detail and up to
two actions.

### Reused, not rebuilt

- Wallet copy for no wallet, locked and wrong network comes from
  `walletErrorMessage` in `lib/stellar/v2/wallet-errors.ts`, so a failed
  connect and the gate say the same words. A unit test compares them.
- `WalletSetupHelp` and `InstallWalletDialog` stay the install help. Pass
  `<WalletSetupHelp />` to the gate's `help` slot and open
  `InstallWalletDialog` from `onInstall`.
- `ReceivingWalletVerification` stays the full verification screen for
  writers. The gate's `verifyHref` links to it.
- `formatXlmFromStroops` in `lib/copy/network-status.ts` formats amounts.
- The tips-unavailable reasons and their copy match `TipsUnavailableNote`
  from the article registration work, word for word, so either can render
  them.

## Mapping server and wallet states

### Record status to phase (`phaseFromRecord`, `phaseFromTabTip`)

| Server status                        | Phase                | Notes                                                                           |
| ------------------------------------ | -------------------- | ------------------------------------------------------------------------------- |
| `PREPARED`, client in a step         | that step            | `simulating`, `signing` or `sending` while the user is in the flow              |
| `PREPARED`, no client step           | `checking`           | A reload during the flow. Stays "checking" until the server marks it `EXPIRED`. |
| `SUBMITTED`                          | `checking`           |                                                                                 |
| `CONFIRMED`                          | `confirmed`          |                                                                                 |
| `MISMATCH`, `mismatchReason: author` | `sent-to-registered` | Complete. No retry.                                                             |
| `MISMATCH`, `field:*` or `no_event`  | `under-review`       | No retry. The record is flagged for review.                                     |
| `FAILED`                             | `failed`             | Retry offered.                                                                  |
| `EXPIRED`                            | `expired`            | Retry offered, with a new `client_ref`.                                         |
| Tab `ACCEPTED`                       | `accepted`           | Shown as sent, "settles on Stellar soon".                                       |
| Tab `SETTLED`                        | `settled`            |                                                                                 |
| Tab `SHORTFALL`                      | `shortfall`          | Not final: settles after a top-up.                                              |
| Tab `UNPAID`                         | `unpaid`             | Final.                                                                          |
| Tab `REJECTED`                       | `under-review`       |                                                                                 |
| Tab `VOID_RESET`                     | `void-reset`         | Testnet reset only.                                                             |

A final server status always wins over a client step.

### Wallet errors (`gateFromWalletError`, `failureFromWalletError`)

| Wallet error kind                                               | Goes to                                        |
| --------------------------------------------------------------- | ---------------------------------------------- |
| `no-wallet`, `locked`, `wrong-network`                          | `WalletGate`                                   |
| `rejected`, `timeout`, `wrong-account`, `unsupported`, `failed` | `TransactionProgress` as `failed`, wallet copy |
| `cancelled`                                                     | Nothing. Closing the picker is not an error.   |

A wallet refusal happens before anything is signed, so the flow marks the
record `FAILED` and "Try again" is safe.

### Contract and send errors (`noticeFromContractFailure`, `failureFromContract`)

| Code or text                                   | Shows                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| 1000 `EnforcedPause`                           | Notice: paused                                                            |
| 1 `NotRegistered`                              | Notice: tips unavailable (`unregistered`)                                 |
| 35 `KeyNotFound`                               | Notice: session key missing                                               |
| 41 `WithdrawLocked`                            | Notice: withdrawal pending                                                |
| No code, text says insufficient or underfunded | Notice: insufficient balance (wallet)                                     |
| Any other code                                 | `failed`, titled "Not sent", the mapped message, then "Nothing was paid." |

## State definitions

Each column of the matrix below is one of these states. The copy is exact.
"Announced" is what assistive technology reads when the state appears.

### Wallet gate

The gate wraps the content that needs a wallet and renders it only when the
state is `ready`. Its action button keeps the same DOM node from one blocked
state to the next, so focus stays on it. When the gate opens after the user
acted in it, focus moves to the first control of the content (for example
"Send tip"). While the wallet prompt is open (`busy`), the button reads
"Waiting for your wallet…", is `aria-disabled`, and keeps focus.

| State              | Title                         | Detail                                                                                                                                           | Action         | Tone    |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------- |
| Checking           | Checking your wallet          | This takes a moment.                                                                                                                             | none (spinner) | inline  |
| Signed out         | Sign in to continue           | Tips and tabs belong to your QuillTip account.                                                                                                   | Sign in        | neutral |
| No wallet          | No Stellar wallet found       | Install a Stellar wallet such as Varial (formerly Freighter) or xBull in this browser, then try again.                                           | Set up wallet  | neutral |
| Not connected      | Connect your wallet           | Connecting shares your address. It does not send a payment.                                                                                      | Connect wallet | neutral |
| Locked wallet      | Your wallet is locked         | Unlock your wallet, allow QuillTip to connect, then try again.                                                                                   | Try again      | warning |
| Wrong network      | Switch your wallet to Testnet | Your wallet is on {network}. QuillTip uses Testnet. Change the network in your wallet, then check again. Nothing was signed.                     | Check again    | warning |
| Unverified address | Confirm this wallet is yours  | Sign a short message in your wallet to link it to your account. It sends nothing and costs nothing. ("it" becomes the short address when known.) | Confirm wallet | neutral |

Announced: "{title}. {detail}" through a polite live region that stays
mounted, once per change.

"Connect wallet" is sentence case, like "Set up wallet" in the launch copy
guide. The current tip dialog says "Connect Wallet"; it changes when the tip
flow adopts the gate.

### Progress

Wallet-signed flows show four steps: **Check**, **Approve in wallet**,
**Send**, **Confirm**. Done steps show a tick, the current step a turning ring,
later steps a hollow dot. One sentence under the list says what is happening.

| Phase                          | Sentence (shown and announced politely)                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Simulating                     | Checking the details with Stellar testnet…                                                                                        |
| Waiting for wallet (`signing`) | Approve the request in your wallet. It shows the network fee.                                                                     |
| Sending                        | Sending to Stellar testnet…                                                                                                       |
| Checking                       | Waiting for Stellar testnet to confirm. You can close this; it finishes without you.                                              |
| Checking, `slow`               | **Still checking.** Stellar testnet is slow to answer. If the payment went through, it shows here. You will not be charged twice. |
| Tab tip, sending               | Sending your tip… (one line, no step list: a tab tip has no wallet prompt)                                                        |

Set `slow` once the client has polled past `maxTime + 30 s` with no answer.
"View the transaction" appears as soon as a hash exists.

### Results

| Phase                                 | Title                                               | Detail                                                                                                                                                              | Action               | Tone    | Announced |
| ------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------- | --------- |
| Confirmed                             | per flow (below)                                    | per flow (below)                                                                                                                                                    | View the transaction | success | polite    |
| Sent to the registered payout address | Tip sent to the article’s registered payout address | Stellar testnet paid the address registered for this article, which differs from the one shown when you started. The tip is complete, so there is nothing to retry. | View the transaction | info    | polite    |
| Under review                          | Finished, but under review                          | The transaction completed on Stellar testnet, but not as QuillTip expected. We are checking it. Do not send it again.                                               | View the transaction | warning | polite    |
| Failed                                | Not sent (or the wallet's title)                    | Nothing was paid. (or the mapped message followed by "Nothing was paid.")                                                                                           | Try again            | danger  | assertive |
| Expired                               | This request timed out                              | It was not sent in time, so nothing was paid. Try again to start a new request.                                                                                     | Try again            | warning | assertive |
| Tab tip accepted                      | Tip sent from your tab                              | It settles on Stellar testnet soon. No wallet prompt needed.                                                                                                        | none                 | info    | polite    |
| Tab tip shortfall                     | Waiting for the tab balance                         | This tip is recorded, but the tab ran short. It settles after the next top-up.                                                                                      | none                 | warning | polite    |
| Tab tip unpaid                        | Not paid                                            | The tab closed before this tip settled.                                                                                                                             | none                 | danger  | polite    |
| Tab tip void reset                    | Cleared by a testnet reset                          | Stellar testnet was reset before this tip settled. No real money was involved.                                                                                      | none                 | neutral | polite    |

Announced text is "{title}. {detail}". When a result arrives after mount and
focus would be lost (the button that started the payment is gone, or focus is
already inside the progress view), focus moves to the result title. A result
present on page load takes no focus and plays no animation.

Confirmed copy per flow:

| Flow                | Title                             | Detail                                                                             |
| ------------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| Direct tip          | Tip confirmed                     | Your tip is recorded on Stellar testnet.                                           |
| Highlight tip       | Highlight tip confirmed           | Your tip for this passage is recorded on Stellar testnet.                          |
| Tip basket          | Tips confirmed                    | Every tip in your basket is recorded on Stellar testnet.                           |
| Open tab            | Your tab is open                  | Tip from it on this device without a wallet prompt.                                |
| Top-up              | Top-up confirmed                  | Your tab balance is updated.                                                       |
| Tab tip (`settled`) | Tip settled                       | Your tip is paid out on Stellar testnet.                                           |
| New key             | Quick tips are on for this device | This browser can tip from your tab without a wallet prompt.                        |
| Close tab (start)   | Withdrawal started                | Your balance unlocks after the waiting period. Tips you already sent settle first. |
| Withdraw            | Withdrawal complete               | Your tab balance is back in your wallet.                                           |
| Collect             | Earnings collected                | They are in your wallet now.                                                       |
| Settle own voucher  | Voucher settled                   | These tips are paid. Collect them to move them to your wallet.                     |
| Mint                | Article NFT minted                | The NFT is in your wallet on Stellar testnet.                                      |
| Transfer            | NFT transferred                   | The new owner holds it now.                                                        |

### Notices

Notices describe a standing condition, not a step. Each is announced politely
(`role="status"`) when it appears.

| Notice                       | Title                                                                                    | Detail                                                                                                                                                                                   | Action (default label)  | Tone    |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------- |
| Paused                       | Payments are paused                                                                      | QuillTip paused this action for maintenance. Tips already sent still settle, and you can still collect or withdraw.                                                                      | none                    | warning |
| Insufficient balance, wallet | Not enough XLM in your wallet                                                            | This needs {amount} plus a small network fee. Your wallet has {balance}. Without amounts: Add test XLM to your wallet or choose a smaller amount. The network fee is small but not zero. | Choose a smaller amount | warning |
| Insufficient balance, tab    | Not enough in your tab                                                                   | Your tab has {free} free after tips still settling. Top up or choose a smaller tip. Without an amount: Top up your tab or choose a smaller tip.                                          | Top up                  | warning |
| Session key missing          | This device’s quick-tip key is gone                                                      | Your browser cleared it. Your balance is safe, and tips you already sent still settle. Set up quick tips again to keep tipping from your tab.                                            | Set up quick tips       | info    |
| Session key expired          | Quick tips on this device have expired                                                   | Your balance is safe, and tips you already sent still settle. Renew to keep tipping without a wallet prompt.                                                                             | Renew quick tips        | info    |
| Settlement delayed, reader   | Settlement is taking longer than usual                                                   | Your tips are recorded and will settle. Nothing is lost.                                                                                                                                 | none                    | info    |
| Settlement delayed, writer   | Settlement is taking longer than usual                                                   | These tips are recorded and will settle. You can also settle them yourself with your saved voucher.                                                                                      | Settle it yourself      | info    |
| Withdrawal pending           | Your withdrawal unlocks on {date} (without a date: Your withdrawal is waiting to unlock) | Your tab is closing. Tips you already sent settle first, and quick tips are off. A deposit before then cancels the withdrawal.                                                           | none                    | info    |
| Withdrawal ready             | Your balance is ready to withdraw                                                        | The waiting period is over. Withdraw to move it to your wallet.                                                                                                                          | Withdraw {amount}       | success |
| Network busy                 | Stellar testnet is busy                                                                  | Nothing changed. Try again in a minute.                                                                                                                                                  | none                    | warning |

Tips unavailable is a one-line note in place of the tip button, not a panel:

| Reason            | Copy                                                                                                         | Action          |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | --------------- |
| `unregistered`    | Tips aren’t on for this article yet.                                                                         | none            |
| `pending`         | Tips for this article turn on in a moment.                                                                   | none            |
| `payout_outdated` | Tips are paused while the writer updates their wallet.                                                       | none            |
| `splits`          | Quick tips don’t work for this article because it shares tips with co-authors. Tip from your wallet instead. | Tip from wallet |

When to show:

- **Paused:** `chainConfig.paused`, or a simulation error with code 1000. Only
  for actions the pause blocks: tips, batches, deposits, opening a tab, new
  keys, mints and transfers. Never for collect, settle own, close tab or
  withdraw (I-27).
- **Session key expired:** from one day before `valid_until`, when Convex stops
  accepting the key ([section 3.5](../architecture/v2/03-tab-contract.md#35-session-keys)).
- **Settlement delayed:** when the reader's or writer's oldest accepted tab tip
  has waited more than 6 hours, the settler alert threshold in
  [section 7.4](../architecture/v2/07-security-and-recovery.md#74-failure-recovery).
- **Network busy:** RPC timeouts or a failed `getHealth`. Nothing changes state.

### History status labels

`PaymentStatusLabel` shows one word or phrase with a coloured dot that repeats
the meaning; the text alone carries it.

| Phase                                  | Label                      |
| -------------------------------------- | -------------------------- |
| simulating, signing, sending, checking | Confirming                 |
| confirmed                              | Confirmed                  |
| sent-to-registered                     | Sent to registered address |
| under-review                           | Under review               |
| failed                                 | Not sent                   |
| expired                                | Timed out                  |
| accepted                               | Settling                   |
| settled                                | Settled                    |
| shortfall                              | Waiting for balance        |
| unpaid                                 | Not paid                   |
| void-reset                             | Cleared by reset           |

## State matrix

Key: **●** applies with the copy above. A number points to a note below the
table. **–** does not apply.

| Flow               | No wallet | Locked | Wrong network | Unverified | Insufficient balance | Simulating | Waiting for wallet | Sending | Checking | Confirmed | Sent to registered address | Failed, retry | Expired, retry | Paused | Session key expired or missing | Settlement delayed | Tips unavailable |
| ------------------ | :-------: | :----: | :-----------: | :--------: | :------------------: | :--------: | :----------------: | :-----: | :------: | :-------: | :------------------------: | :-----------: | :------------: | :----: | :----------------------------: | :----------------: | :--------------: |
| Direct tip         |     ●     |   ●    |       ●       |    ● 1     |       ● wallet       |     ●      |         ●          |    ●    |    ●     |     ●     |             ●              |       ●       |       ●        |   ●    |               –                |         –          |       ● 2        |
| Highlight tip      |     ●     |   ●    |       ●       |    ● 1     |       ● wallet       |     ●      |         ●          |    ●    |    ●     |     ●     |             ●              |       ●       |       ●        |   ●    |               –                |         –          |       ● 2        |
| Tip basket         |     ●     |   ●    |       ●       |    ● 1     |       ● wallet       |     ●      |         ●          |    ●    |    ●     |    ● 3    |            ● 3             |      ● 3      |       ●        |   ●    |               –                |         –          |       ● 4        |
| Open tab           |     ●     |   ●    |       ●       |    ● 1     |       ● wallet       |     ●      |         ●          |    ●    |    ●     |     ●     |             –              |       ●       |       ●        |   ●    |               –                |         –          |        –         |
| Top-up             |     ●     |   ●    |       ●       |    ● 1     |       ● wallet       |     ●      |         ●          |    ●    |    ●     |    ● 5    |             –              |       ●       |       ●        |   ●    |               –                |         –          |        –         |
| Tab tip            |    – 6    |  – 6   |      – 6      |    – 6     |        ● tab         |     –      |         –          |   ● 7   |    –     |    ● 8    |             –              |      ● 9      |       –        |  ● 10  |               ●                |      ● reader      |       ● 2        |
| New key            |     ●     |   ●    |       ●       |    ● 1     |     ● wallet 11      |     ●      |         ●          |    ●    |    ●     |     ●     |             –              |       ●       |       ●        |   ●    |              ● 12              |         –          |        –         |
| Close tab (start)  |     ●     |   ●    |       ●       |    ● 1     |     ● wallet 11      |     ●      |         ●          |    ●    |    ●     |   ● 13    |             –              |       ●       |       ●        |   –    |               –                |      ● reader      |        –         |
| Withdraw           |     ●     |   ●    |       ●       |    ● 1     |     ● wallet 11      |     ●      |         ●          |    ●    |    ●     |     ●     |             –              |       ●       |       ●        |   –    |               –                |         –          |        –         |
| Collect            |     ●     |   ●    |       ●       |    ● 14    |     ● wallet 11      |     ●      |         ●          |    ●    |    ●     |     ●     |             –              |       ●       |       ●        |   –    |               –                |      ● writer      |        –         |
| Settle own voucher |     ●     |   ●    |       ●       |    ● 14    |     ● wallet 11      |     ●      |         ●          |    ●    |    ●     |     ●     |             –              |       ●       |       ●        |   –    |               –                |    ● writer 15     |        –         |
| Mint               |     ●     |   ●    |       ●       |    ● 14    |     ● wallet 11      |     ●      |         ●          |    ●    |    ●     |     ●     |             –              |       ●       |       ●        |   ●    |               –                |         –          |       – 16       |
| Transfer           |     ●     |   ●    |       ●       |    ● 1     |     ● wallet 11      |     ●      |         ●          |    ●    |    ●     |     ●     |             –              |       ●       |       ●        |   ●    |               –                |         –          |        –         |

Notes:

1. The reader's linked address must be proven ("Confirm this wallet is
   yours"). Prepare refuses a wallet that is not linked to the account.
2. Shown instead of the tip button, with the reason Convex reports. `splits`
   applies to tab tips only and offers "Tip from wallet".
3. A batch is atomic: every row confirms or fails together. Each row is still
   verified on its own, so one row can be `sent-to-registered` while the rest
   are `confirmed`. Show the overall result, then a `PaymentStatusLabel` per
   line.
4. Items whose article cannot take tips are removed from the basket before
   prepare, each with its one-line note.
5. A deposit during a pending withdrawal cancels it. When the account was
   closing, add `resultDetail`: "Your withdrawal was cancelled because you
   added funds." (flow copy, owned by the tab session).
6. A tab tip needs no wallet prompt. The reader must be signed in and have an
   open tab with a usable key on this device; otherwise show the tab setup or
   the key notice.
7. One line, "Sending your tip…", while `submitTip` runs.
8. `accepted` first ("Tip sent from your tab"), `settled` later. `shortfall`,
   `unpaid` and `void-reset` follow the result table.
9. A refused submission (balance, limit or key changed) retries once
   automatically from prepare, as the flow requires. If it still fails, show
   `failed` with the mapped message.
10. Only if Convex refuses tab tips while Core is paused. Settlement itself is
    never paused.
11. These flows move no XLM from the wallet beyond the network fee, so the
    insufficient-balance notice uses its no-amount copy.
12. The new-key flow is the action behind both session-key notices.
13. Pair the confirmed panel with the withdrawal-pending notice and the unlock
    date.
14. A writer's receiving wallet must be verified; use `verifyHref` to the
    dashboard wallet page.
15. Settle own is the action behind the writer's settlement-delayed notice.
16. The mint action appears only when the article has reached the threshold
    ([section 5.10](../architecture/v2/05-flows-and-admin.md#510-nft-mint-and-transfer)).
    Below it, there is no button, so no notice.

## Amounts

- **Primary:** XLM from base units, through `formatXlm` (`formatXlmFromStroops`).
  Full stroop precision, grouped thousands, no trailing zeros: `0.975 XLM`,
  `0.0000039 XLM`, `12,345,678,901.2345678 XLM`. Invalid input shows "–", never
  a wrong number.
- **Secondary:** the cents quote, when the caller has one, after the testnet
  label: "About $0.12, no real value". It is a quote, not the amount paid.
- **Breakdown:** pass the author share and the platform fee as values from
  Convex (the prepare response) or the `Tipped` event. The kit labels them
  "To the author · 97.5%" and "Platform fee · 2.5%" as the caller supplies. For
  a preview before prepare returns, `coreTipSplit` mirrors the Core rule: the
  fee is `floor(gross × 250 / 10,000)` and the author side gets the remainder
  (I-1). A 40-stroop tip splits 39 and 1.
- **Co-author splits:** one breakdown row per recipient, in the registered
  order, then the platform fee.
- Figures use tabular numerals. Long amounts wrap below their label rather
  than overflow.

## Testnet labelling

- Every payment surface shows `TestnetLabel` ("Stellar testnet") once: inside
  `AmountSummary` when there is an amount, otherwise beside the surface
  heading. `TestnetLabel detail` adds "Practice funds, no real value" where a
  reader first meets an amount, such as the first tip dialog step.
- Progress and result copy names Stellar testnet in the sentence ("Sending to
  Stellar testnet…").
- Amounts read "XLM", not "test XLM": the label next to them carries the
  network. This replaces "1 test XLM" in the current dialog.
- The copy is testnet-only by design while the network guard refuses mainnet.
  A mainnet launch is a reviewed copy change, not a flag.

## Motion

| What                                | How                                                                                     | Reduced motion   |
| ----------------------------------- | --------------------------------------------------------------------------------------- | ---------------- |
| Result reached after mount          | Rises in once: opacity 0 to 1 and 4 px upward, 220 ms, `cubic-bezier(0.32, 0.72, 0, 1)` | none             |
| Confirmed or settled tick           | The tick draws in, 260 ms after a 120 ms delay, ease-out                                | drawn at once    |
| Current step and spinners           | Ring turns, 0.9 s per turn, linear                                                      | static open ring |
| Button press                        | Scales to 0.97, 150 ms ease-out                                                         | none             |
| Step changes, gate changes, notices | No animation. Text and markers swap in place.                                           | n/a              |

There is one authored moment, the confirmation. Nothing animates on page load,
and nothing animates layout properties. Paired elements do not exist in the
kit, so there is no shared timing to keep.

## Accessibility

- `TransactionProgress` and `WalletGate` keep their live regions mounted from
  the first render, so each change is read once. Progress uses a polite region
  for steps and good news, and an assertive one for `failed` and `expired`.
- Notices use `role="status"`.
- The step list is an ordered list labelled "Progress"; the current step has
  `aria-current="step"` and done steps read "(done)".
- Result titles are headings (level 3 by default, `headingLevel` to change).
- Every action is a real button or link, at least 44 px high, with a visible
  focus ring in the surface's ring colour. Explorer links say they open a new
  tab.
- Icons are decorative (`aria-hidden`); the title always says the state in
  words. Colour never carries meaning alone.
- Inside the tip dialog, which is always light, the kit pins the light status
  colours so dark mode does not lower contrast.
- `e2e/payment-states.spec.ts` checks every state at 375, 768 and 1440 px
  with axe (WCAG 2.2 AA tags), no horizontal overflow, keyboard order, focus
  after a result, live-region text, reduced motion, long amounts and errors,
  reflow at 640 px (200 % zoom of 1280) and 320 px, text-spacing overrides,
  and dark mode.

## Using the kit in a flow

1. Build `WalletGateState` from the wallet adapter and the account: signed in,
   connected, network, and whether the address is verified. Wrap the
   payment's primary action in `WalletGate`.
2. Show `AmountSummary` with the values from the prepare response.
3. While the user is in the flow, pass the live step (`simulating`,
   `signing`, `sending`) to `phaseFromRecord` with the record; after that,
   the record alone decides. Render `TransactionProgress` with the result.
4. Map failures: `gateFromWalletError` first (back to the gate), then
   `noticeFromContractFailure` (a notice), else `failureFromWalletError` or
   `failureFromContract` into the `failure` prop.
5. On "Try again", start a new prepare with a new `requestId`; never resend
   the old envelope.
6. Use `PaymentStatusLabel` with `phaseFromRecord` or `phaseFromTabTip` in
   history rows.

The fixture page shows each state by id:
`http://127.0.0.1:4180/?state=result-failed`. Add `&theme=dark` for the dark
palette.
