# Tab screens (`components/tab/`)

Reader tab home, quick tips from the tab, and the writer's collect panel
(issue #449). Stellar testnet only. Every state renders through the payment
kit (`components/payments/`, `docs/design-system/payment-states.md`).

| Entry                | Where                                   | Loads with `import()` |
| -------------------- | --------------------------------------- | --------------------- |
| `TabPageLoader`      | `/dashboard/tab`                        | `TabHomeLive`         |
| `CollectPanelLoader` | `/dashboard/stats`                      | `CollectPanelLive`    |
| `LazyTabTipAction`   | the tip dialog (mounted by the tips UI) | `TabTipActionLive`    |

Nothing here may enter the first load of `/`, `/login`, `/articles` or the
article page: mount only the three entries above, never the components they
load.

## Quick tip for the tip dialog

```tsx
import { LazyTabTipAction } from '@/components/tab/LazyTabTipAction'
;<LazyTabTipAction
  articleId={article._id} // Convex article id
  highlight={highlight ?? null} // optional passage for a highlight tip
  recipientCount={eligibility.recipientCount} // tipsV2.getTipEligibility
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
- The hook behind it is `useTabTip(target)` (`hooks/tab/useTabTip.ts`) for a
  custom layout; it needs a `TabServicesContext` provider
  (`useLiveTabServices`).

## Services seam

The screens read and act only through `TabServices`
(`lib/tab-ui/types.ts`): Convex reads and prepares, Stellar RPC, the wallet,
and the session-key store. `hooks/tab/useLiveTabServices.ts` is the app's;
`e2e/fixtures/tab-ui/services.ts` is the fixture's (port 4183).
