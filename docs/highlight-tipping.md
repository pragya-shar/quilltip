# Highlight Tipping

Phrase-level tipping — readers select text, tip specific highlights, authors see earnings heatmap.

## Highlight ID Formula

```text
data = "{articleSlug}:{startOffset}:{endOffset}:{text[0:50]}"
highlightId = SHA256(data)[0:28]   # 28 chars fits Stellar memo field
```

Same formula is used in:

- Client: `lib/stellar/highlight-utils.ts`
- Server: `convex/lib/highlightHash.ts`
- Contract: receives pre-generated hash (does not re-hash)

## Contract History

| Contract                     | ID            | Role                                               | Status     |
| ---------------------------- | ------------- | -------------------------------------------------- | ---------- |
| Original article tipping     | `CBSV...HWAM` | Article tips only                                  | Retired    |
| Standalone highlight tipping | `CDON...64AB` | Highlight tips only (two-contract safety approach) | Retired    |
| **Unified tipping**          | `CASU...CVWG` | Article + highlight tips, Pausable, Arweave-aware  | **Active** |

The unified contract (`CASU4I45DVK3ZMXA3T34A3XF3BM4NBTFDW3QVCB3XA7PIWJSTN4HCVWG`) has both:

- `tip_article()` / `tip_article_with_arweave()`
- `tip_highlight_direct()` / `tip_highlight_with_arweave()`
- `get_highlight_tips(highlight_id)` — query all tips for a highlight
- `pause()` / `unpause()` / `is_paused()` (OpenZeppelin Pausable)

Fee split: 97.5% author, 2.5% platform (250 basis points).

## Database Schema

### `highlightTips` table (`convex/schema.ts`)

| Field            | Type               | Notes                           |
| ---------------- | ------------------ | ------------------------------- |
| `highlightId`    | `string`           | SHA256 hash (see formula above) |
| `articleId`      | `id("articles")`   | Parent article                  |
| `tipperId`       | `id("users")`      | Who tipped                      |
| `authorId`       | `id("users")`      | Who receives                    |
| `highlightText`  | `string`           | The selected text               |
| `articleTitle`   | `string`           | Denormalized                    |
| `tipperName`     | `optional(string)` | Denormalized                    |
| `authorName`     | `optional(string)` | Denormalized                    |
| `amountCents`    | `number`           | Tip amount in cents             |
| `stellarTxId`    | `string`           | Stellar transaction hash        |
| `stellarNetwork` | `string`           | `TESTNET` or `MAINNET`          |
| `stellarMemo`    | `string`           | Highlight ID in memo            |
| `startOffset`    | `number`           | Text position start             |
| `endOffset`      | `number`           | Text position end               |
| `status`         | `string`           | `CONFIRMED` / `FAILED`          |
| `createdAt`      | `number`           | Epoch ms                        |
| `processedAt`    | `number`           | Epoch ms                        |

Indexes: `by_highlight`, `by_article`, `by_tipper`, `by_author`.

### `highlights` table

Existing table — extended with `highlightId: v.string()` (required after migration backfill).

## Key Components

| File                                           | Role                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `lib/stellar/highlight-utils.ts`               | `generateHighlightId()`, `getHeatmapColor()`, `formatTipAmount()`                |
| `lib/stellar/client.ts`                        | `buildHighlightTipTransaction()` — builds Soroban call to `tip_highlight_direct` |
| `convex/highlightTips.ts`                      | `create`, `getByHighlight`, `getByArticle` mutations/queries                     |
| `components/highlights/HighlightTipButton.tsx` | Tip popover (10c / 50c / $1 presets)                                             |
| `components/highlights/HighlightHeatmap.tsx`   | Author dashboard — top tipped phrases, Yellow→Orange→Red gradient                |
| `components/highlights/HighlightExtension.ts`  | TipTap mark extension for inline highlight rendering                             |
| `components/highlights/HighlightConverter.ts`  | Converts DB highlights to editor positions                                       |
| `components/highlights/HighlightNotes.tsx`     | Sidebar showing highlights that have notes                                       |
| `components/articles/ArweaveStatus.tsx`        | Shows "Permanent Storage" badge on article page                                  |

## Inline UX Model

1. Reader selects text → TipTap `onSelectionUpdate` fires
2. Popover appears with color picker + tip buttons
3. Reader clicks tip amount → wallet popup (Freighter / xBull / Albedo)
4. Stellar transaction submitted to unified contract
5. On success: `highlightTips.create` mutation records in Convex
6. Heatmap updates in real-time via Convex subscription

### Highlight Rendering

- TipTap mark extension renders highlights as colored `<mark>` elements
- Hover: brightness increase + pulse animation
- Notes indicator: small icon on highlights with attached notes
- Overlap: first-color wins (simple, acceptable for MVP)

## Tipping Flow (Sequence)

```text
Reader selects text
  → generateHighlightId(articleSlug, text, start, end)
  → stellarClient.buildHighlightTipTransaction(pubkey, {highlightId, articleId, authorAddr, amountCents})
  → wallet signs XDR
  → stellarClient.submitTipTransaction(signedXDR)
  → convex highlightTips.create({highlightId, articleId, ...})
  → UI updates via Convex real-time subscription
```

## Status

- Implementation: Complete
- User validation: Pending (need 10–20 real highlight tips)
- Inline UX optimization: Complete (71% fewer clicks vs old sidebar approach)
