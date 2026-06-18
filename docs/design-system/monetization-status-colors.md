# Monetization Status Colors

Reader-facing tip, highlight-tip, and NFT surfaces use semantic status tokens from `app/globals.css` instead of ad-hoc Tailwind palette classes.

## Token mapping

| State | Tailwind utilities |
|-------|-------------------|
| Wallet not connected | `bg-warning text-warning-foreground border-warning/30` |
| Tip sent / upload verified | `bg-success text-success-foreground` |
| Pending upload / informational | `bg-info text-info-foreground` |
| Section icons / quiet stats | `text-muted-foreground` |
| Heat intensity / NFT progress fill | `bg-primary/50` on `bg-muted` track |
| Error / failed upload | `destructive` button or `bg-destructive/10 text-destructive` |

## Accent

Wallet and NFT actions use `--primary` as the single subdued accent. No separate `--monetization` token.

## CTAs

Monetization buttons use `Button` variants from `components/ui/button.tsx` (`outline`, `default`, `secondary`). Avoid custom gradients, `hover:scale-*`, and heavy shadows on tip/NFT controls.
