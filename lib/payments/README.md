# Balance payments: the headless layer

Tips from a reader's balance, and the reader's and writer's money views, as
plain data behind four hooks. A UI renders these hooks and nothing else: it
never imports Convex, the wallet kit, `lib/stellar` or the files below the
line. Stellar testnet only; every screen says so.

```tsx
import { useBalance } from '@/hooks/payments/useBalance'
import { useTip } from '@/hooks/payments/useTip'
import { useActivity } from '@/hooks/payments/useActivity'
import { useEarnings } from '@/hooks/payments/useEarnings'
```

Types are in `types.ts`; money formatting in `money.ts`.

## Hooks

### `useBalance(): BalanceView`

The signed-in reader's balance.

| `status`      | Meaning                             | Figures                                                                                                                 |
| ------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `loading`     | auth or the first answer is pending | `available`, `pending`, `limits` are `null`; `amounts` is empty                                                         |
| `signed-out`  | no reader                           | as loading                                                                                                              |
| `none`        | signed in, answered, no balance yet | real zeros ("≈ $0.00", "$0.00")                                                                                         |
| `ready`       | answered                            | `available` ("≈ $2.54", converted at today's price), `pending` (accepted tips not yet paid, exact), `limits`, `amounts` |
| `closing`     | the balance is being withdrawn      | figures as ready; tips are refused                                                                                      |
| `unavailable` | payments could not load or answer   | `null`; reading is unaffected                                                                                           |

Also: `device` (`loading`, `ready`, `needs-setup`, `unavailable`): whether
this device can tip without a prompt; `online`; `settlement.expectedWithinMs`;
`exact` (`{ token: 'XLM', available }`: spendable in base units, the figure
behind "≈", null until read); `asOf` (client time the figures were last
known current: it follows the clock while online and stops when offline, so
a screen can say "as of 4 minutes ago"; null until read).

If the reader spent from the balance outside the app, spendable can be
below zero on the ledger: `available` reads "≈ $0.00" and no amount fits
(`noAmountReason: 'balance'`).

Never: prints a placeholder zero, asks for a wallet signature, or moves money.

### `useTip(target, meta): TipController`

One control for an article or a passage. `target` names what is tipped;
`meta` labels the optimistic row ("Sending") before the server answers.

- `ready` false: the balance, the device or the article check is loading.
  Show nothing, or the control disabled; `amount` is `null`.
- `warming` true: signed in and the payments code is still loading. Show the
  control; a tap is kept (`queued`) and sent once, when ready.
- `unavailable` (not `null`): this reader cannot tip here from the balance
  (`signed-out`, `no-balance`, `closing`, `device`, `own-article`,
  `not-tippable`, `settlement-off`, `not-loaded`, `absent`). Keep any other
  tip path the page has; `absent` means no payments shell is mounted.
- `amount`: what the button states and sends ("Tip this line $0.10");
  `amounts`: the quick choices within every limit; `setAmount(cents)`.
- `blocked`: `cap`, `daily`, `balance` or `choose`, with no token figure.
- `tip()`: sends at once, no wallet prompt. `state.phase` goes `sending`, then
  `sent` only after the server accepted (final: there is no Undo), or
  `failed` (nothing charged), `offline` (checked first, nothing sent),
  `needs-funds`. A second tap while sending is ignored. `reset()` returns to
  `idle`.

Never: sends twice for one tap or a double tap, says "Sent" before the
server accepted, follows the writer, saves a highlight, or shares anything.

### `useActivity(role): ActivityView`

`role` `reader`: tips sent; `writer`: tips received. Newest first, paged
(`canLoadMore`, `loadMore()`, `loadingMore` while a further page loads);
`status` `loading` (the first page), `ready` or `unavailable`.
Each `ActivityItem`:

- `amount`: the tip as the reader sent it, whole cents, exact. Show this in
  a list on both sides.
- `net`: the writer's exact share (1/10,000 cent). Show it in the detail with
  `formatExactCents` ("48.75¢"), never floored.
- `status`: `sending` (reader only, not answered), `sent` (accepted, on its
  way), `on-chain` ("Added to earnings"), `not-paid` with `reason`
  (`shortfall`: on hold until the reader adds money; others final).
  `paid`, `paidNet`: what reached the writer of a tip paid in part.
- `fee`: the platform's 2.5% of the tip (`amount - net`); `unpaid`,
  `unpaidNet`: what is not paid yet, and the writer's share of it. All
  exact, from the server: a screen never subtracts amounts. A sending row
  has `net` and `fee` of zero until the server prices it.
- `lagging`: accepted and older than settlement normally takes.
- `requestId`: the same on both sides and in the server's receipt.
- The writer's `counterparty` is always "A reader".

### `useEarnings(): EarningsView`

The signed-in writer's money. Figures exist only when `status` is `ready`.
`status: 'none'`: signed in, never published and never received a tip:
there are no earnings to show (not earnings of zero). `asOf` as on the
balance.

- `available`: paid on chain and collectable now ("Ready to withdraw").
- `pending`: accepted, not yet paid ("On its way").
- `collected`: already in the writer's wallet ("Paid to your wallet"); the
  only figure that may say "paid to your wallet".
- `onHold`, `notPaid` with `counts`; `lagging`; `exact` token amounts.
- A tip paid in part counts its paid part as available (once, as one tip)
  and the rest as on hold or not paid.

`useNow(everyMs)` gives the time for "4 min ago" and lag notices.

## A tip on hold (shortfall)

When a tip is paid out and the reader's balance is short, the tip is on hold
until the reader adds money. Where it sits:

|              | Reader (`useBalance`, `useActivity('reader')`)                          | Writer (`useEarnings`, `useActivity('writer')`)                                        |
| ------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Figure       | inside `pending` (its unpaid part stays reserved); never in `available` | in `onHold` (its unpaid share) with `counts.onHold`; never in `pending` or `available` |
| Row          | `not-paid`, `reason: 'shortfall'`, `unpaid`                             | `not-paid`, `reason: 'shortfall'`, `unpaidNet`                                         |
| Told         | the balance was short; add money and it goes through                    | waiting on a reader's balance                                                          |
| Paid in part | the paid part has left the balance; `unpaid` stays reserved             | the paid part is in `available`; the rest in `onHold`                                  |

A tip can be accepted for a reader whose balance later empties (spent
outside the app): until the payout is attempted it reads "on its way"
(`pending`) on the writer's side; at the payout it moves to on hold.

## Showing money

- A figure is floored to the cent once, at the figure (`formatMoney`); totals
  are exact sums, so a total never exceeds what can be spent or collected,
  and rows never add up to more than their total.
- Dollars converted at today's price carry "≈" (`approxMoney`); dollars
  stored at tip time are exact.
- A ready figure with a positive token amount below a cent reads "<$0.01"
  (`readyMoney`), never "$0.00".
- `null` means "not read yet": show a skeleton, never "$0.00".
- Details may show exact fractions (`formatExactCents`); lists never do.

## Without a backend: `fake.ts`

```tsx
import { PaymentsRuntimeContext } from '@/lib/payments/runtime'
import { fakeRuntime } from '@/lib/payments/fake'
;<PaymentsRuntimeContext.Provider value={fakeRuntime('lagging')}>
  <Screen />
</PaymentsRuntimeContext.Provider>
```

Scenarios (`FAKE_SCENARIOS`): `ready`, `sending`, `sent`, `pending`,
`available`, `lagging`, `failed`, `partly-paid`, `empty`, `loading`,
`unavailable`, `offline`. Each is a fixed snapshot; the hooks' actions do
nothing. `fakePayments(name)` returns the raw views for tests.

`fakeRuntime(name, { role })`: `both` (default; tips sent to another writer
on the reader side, tips received on the writer side), `reader` (earnings
`none`) or `writer` (balance `none`, tips unavailable: `no-balance`).

---

## Below the line (do not import from a UI)

- `runtime.ts`: `PaymentsRuntimeContext` and `shellRuntime`, the default
  runtime over `store.ts`.
- `store.ts`: the store the shell and engine share; the only payments code in
  a first load. Counts mounted shells; queues taps made before the engine.
- `components/payments/PaymentsShell.tsx`: in the root layout; loads
  `PaymentsEngine` after first paint for a signed-in reader, inside its own
  boundary, and retries after a failure. Payments failing never takes the
  page with them.
- `outbox.ts`: tips not yet answered, per user, in `localStorage`; a signed
  submit is resent unchanged after a reload and accepted once.
- `send-queue.ts`, `tip-machine.ts`, `tip.ts`, `live/signer.ts`: sending.
- `views.ts`: server answers to the view types above.
- `copy.ts`: the provisional screens' words.
