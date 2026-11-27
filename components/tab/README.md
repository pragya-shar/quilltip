# Tab screens (`components/tab/`)

Reader tab home, quick tips from the tab, and the writer's collect panel
(issue #449). Stellar testnet only. Every state renders through the payment
kit (`components/payments/`, `docs/design-system/payment-states.md`).

| Entry                | Where                               | Loads with `import()` |
| -------------------- | ----------------------------------- | --------------------- |
| `TabPageLoader`      | `/dashboard/tab`                    | `TabHomeLive`         |
| `CollectPanelLoader` | `/dashboard/stats`                  | `CollectPanelLive`    |
| `LazyTabTipAction`   | the article and passage tip dialogs | `TabTipActionLive`    |

Nothing here may enter the first load of `/`, `/login`, `/articles` or the
article page: mount only the three entries above, never the components they
load.

## Quick tip in the tip dialog

The article and passage tip dialogs (`components/tipping/v2/TipDialogV2.tsx`)
mount the dialog layout. It sends the dialog's amount; it has no amount
choices of its own:

```tsx
import { LazyTabTipAction } from '@/components/tab/LazyTabTipAction'
;<LazyTabTipAction
  layout="dialog"
  articleId={articleId} // Convex article id
  highlight={highlight ?? null} // the passage, for a passage tip
  recipientCount={eligibility.recipientCount} // tipsV2.getTipEligibility
  writerName={authorName}
  manageHref="/dashboard/tab"
  amountCents={check.ok ? check.cents : null} // the dialog's amount
  onMaxChange={setTabMaxCents} // largest tab tip at today's price, or null
  onPhaseChange={onTabPhase} // 'unavailable' | 'ready' | 'busy' | 'result'
  onInvalidAmount={focusAmountField}
  onDone={closeDialog}
/>
```

- The section (`TabTipDialogSection`) checks the amount against
  `tabs.getMyTab().tipLimits` before anything is prepared
  (`lib/tab-ui/tip-limits.ts`) and explains a limit in place, so expected
  refusals never reach Convex. Convex still decides on prepare.
- It renders nothing for a signed-out or unverified reader (the dialog's
  wallet gate covers it) and one line with "Open a tab" for a reader with no
  tab. `docs/design-system/tip-flows.md`, "From your tab", lists every state.

## Standalone quick tip

`LazyTabTipAction` without `layout` renders `TabTipAction`, with its own
presets:

```tsx
<LazyTabTipAction
  articleId={article._id}
  highlight={highlight ?? null}
  recipientCount={eligibility.recipientCount}
  amountCents={amountCents} // optional; the action shows presets otherwise
  writerName={author.name} // for "2.5 XLM to Ada Lovelace"
  onTipFromWallet={openWalletTip} // splits, closing tab, limits
  onAccepted={(receiptId) => {}} // optional
  manageHref="/dashboard/tab"
/>
```

- No wallet prompt: this browser's session key signs a voucher
  (`lib/stellar/v2/tab`). Convex accepts it; the settler settles it later.
- The action shows accepted first ("Tip sent from your tab"), then the
  receipt's status from `tabActivity.getMyTabTips` (settled, shortfall,
  unpaid, rejected, cleared by reset).
- An article with co-author splits (`recipientCount > 1`) gets the kit's
  splits note and "Tip from wallet": a tab tip pays exactly one writer.
- The hook behind both is `useTabTip(target)` (`hooks/tab/useTabTip.ts`) for a
  custom layout; it needs a `TabServicesContext` provider
  (`useLiveTabServices`).

## Services seam

The screens read and act only through `TabServices`
(`lib/tab-ui/types.ts`): Convex reads and prepares, Stellar RPC, the wallet,
and the session-key store. `hooks/tab/useLiveTabServices.ts` is the app's;
`e2e/fixtures/tab-ui/services.ts` is the fixture's (port 4183; `/dialog`
renders the real tip dialogs with them).
