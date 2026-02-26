# Backlog

Outstanding improvements extracted from codebase analysis (Jan 2026). All 6 MUST-have items were resolved. Items below remain open.

## SHOULD HAVE (High Priority)

| ID  | Title                      | Location                           | Notes                                          |
| --- | -------------------------- | ---------------------------------- | ---------------------------------------------- |
| S1  | Error boundaries           | `components/providers/`, all pages | Wrap Editor, TipButton, WalletProvider         |
| S2  | Replace XHR with Fetch     | `lib/upload.ts`                    | Use `fetch()` + `AbortController`              |
| S3  | Upload retry logic         | `lib/upload.ts`                    | Exponential backoff, 3 attempts                |
| S4  | Deduplicate wallet code    | `lib/stellar/wallet-adapter.ts`    | `connect()` and `connectToWallet()` share ~80% |
| S5  | Arweave gateway config     | `lib/arweave/client.ts`            | Move hardcoded URLs to env vars                |
| S6  | Price-fetch rate limiting  | `lib/stellar/helpers.ts`           | 1 s minimum interval between oracle calls      |
| S7  | Structured logging         | Throughout (53 `console.log`)      | Replace with pino or similar                   |
| S8  | Loading skeletons          | Data-fetching components           | ArticleCard, ProfileHeader, TipStats           |
| S9  | NFT client type safety     | `lib/stellar/nft-client.ts:203`    | Remove `as unknown as Record<…>` casts         |
| S10 | Article validation schemas | `lib/validations/`                 | Zod schemas for title, content, excerpt, tags  |
| S11 | Auto-save on unload        | `hooks/useAutoSave.ts:149`         | Use `navigator.sendBeacon()`                   |
| S12 | Offline detection          | Throughout                         | Offline indicator + mutation queue             |

## COULD HAVE (Medium Priority)

| ID  | Title                         | Location                                          | Notes                                   |
| --- | ----------------------------- | ------------------------------------------------- | --------------------------------------- |
| C1  | Email verification            | `convex/auth.ts`                                  | Enable via Resend when production-ready |
| C2  | Password reset flow           | `convex/auth.ts`, `components/auth/`              | Forgot-password with email tokens       |
| C3  | OAuth providers               | `convex/auth.ts`                                  | Google + GitHub                         |
| C4  | Highlight overlap handling    | `lib/highlights/HighlightRenderer.ts:251`         | Color blending or layered rendering     |
| C5  | Request deduplication         | `lib/stellar/helpers.ts`, `lib/arweave/client.ts` | Map-based cache                         |
| C6  | Configurable polling interval | `lib/stellar/wallet-adapter.ts`                   | Currently hardcoded 2000 ms             |
| C7  | Optimistic updates            | Convex mutations                                  | For tips, highlights, likes             |
| C8  | Full-text search              | `convex/articles.ts`                              | Leverage Convex search indexes          |
| C9  | Analytics dashboard           | `app/[username]/page.tsx` (Stats tab)             | Charts with Recharts                    |
| C10 | Image optimization pipeline   | `lib/upload.ts`                                   | Server-side resize + multiple sizes     |
| C11 | Withdrawals                   | `convex/schema.ts` (table exists)                 | Complete withdrawal flow                |
| C12 | Keyboard shortcuts            | `components/editor/Editor.tsx`                    | Cmd+S, Cmd+K, Cmd+B                     |
| C13 | Draft auto-recovery           | `app/write/page.tsx`                              | localStorage backup every 10 s          |
| C14 | Mobile responsiveness         | Various                                           | Editor toolbar, NFT section             |
| C15 | Dark mode toggle              | `components/landing/Navigation.tsx`               | next-themes manual toggle               |

## Pending One-Time Operations

### highlightId Migration

Old highlights in the database lack the `highlightId` field. Steps:

1. Make `highlightId` optional in schema → deploy
2. Run backfill script (`convex/migrations/02_backfillHighlightIds.ts`) — generates SHA256 IDs using the standard formula
3. Validate: all highlights have IDs, no duplicates, no orphaned tips
4. Make `highlightId` required again → deploy

Migration is idempotent and safe to re-run. See migration scripts in `convex/migrations/`.

### Turbo SDK Migration

Replace raw `arweave` package with `@ardrive/turbo-sdk` for free uploads. See [arweave-integration.md](arweave-integration.md) for detailed steps.
