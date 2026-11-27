# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Quilltip serves readers and writers equally, with emphasis on readers.

- **Readers** read articles for free and tip the passages that move them. The
  reader's main action is the tip.
- **Writers** publish articles, earn from tips, and track their earnings.

## Product Purpose

Quilltip is a publishing platform where writers earn from reader tips, with no
subscriptions and no minimum payouts. Readers read for free. Success means that
a reader can tip a passage with one tap, and that the writer receives 97.5% of
that tip.

## Positioning

Passage-level tips. A reader highlights the exact passage that moved them and
tips it, from $0.01. The writer keeps 97.5% of every tip. No subscription is
necessary to read or to write.

## Operating Context

- Readers read an article, highlight passages, add notes, and tip a passage or
  the whole article.
- Writers draft in a rich text editor, publish, and watch earnings on the
  dashboard.
- A wallet is necessary only when a reader tips or a writer receives payment.
  Wallet language appears only after tipping or wallet intent.

## Capabilities and Constraints

- Payments use Stellar and Soroban. During beta, all payments run on Stellar
  testnet with practice funds. Describe testnet activity as testnet activity.
- Fee split: writers receive 97.5% of each tip, the platform receives 2.5%.
- Article storage on Arweave is optional and can be permanent.
- Every article is an NFT under the hood.
- **Open decision:** the code today makes an article eligible for minting after
  $10 of tips, and the author then mints it (`convex/nfts.ts`). Until every
  article is minted automatically, show the NFT badge only on articles that are
  minted.
- Product surfaces import approved strings from `lib/copy/*`. The approved
  vocabulary and CTA labels are in `docs/copy/launch-copy-guide.md`.
- Terminology: published content is called **articles**. Article links say
  **Read more**. Use **tip**, not "micro-tip".

## Brand Commitments

- The name is written **Quilltip** (one capital).
- Voice: minimal copy. Remove each word, control, and element that is not
  necessary.
- Use icons instead of text wherever an icon is clear.
- Show the NFT status proudly with a clear NFT badge. The NFT is not the
  differentiator, and it must not get in the way of reading.
- Approved lines: hero headline "Reward the words that move you"; writer trust
  line "Writers keep 97.5% of every tip".

## Evidence on Hand

- A demo video and a demo account are linked in `README.md`.
- Testnet contract IDs are recorded in `docs/tipping-contract-testnet-deploy.md`.
- No testimonials, customer names, usage figures, or press are on hand. Do not
  invent them.

## Product Principles

1. The tip is the main action. Make it prominent and possible with one tap.
2. Reading comes first. Nothing, the NFT badge included, interrupts the text.
3. Quick actions only. Each action completes in the fewest steps.
4. Less is more. Remove what is not necessary, and prefer an icon to a label.
5. Tell the truth about money. State the 97.5% split and the testnet status
   plainly.
