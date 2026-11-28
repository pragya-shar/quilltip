# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Quilltip serves readers and writers, with emphasis on readers.

- **Readers** read articles for free, on a phone first, and tip the sentence
  or the article that moved them. The reader's main action is the tip.
- **Writers** publish articles, turn on tips for them, and see what their
  writing earns.

## Product Purpose

Quilltip is a place to read and publish articles, where readers pay writers
directly with tips. Reading is free and needs no account. Success means that a
reader can tip one sentence with one tap, that the writer keeps 97.5% of that
tip, and that the reader goes back to reading at the same place.

## Positioning

Writing you can tip, down to the sentence. A reader taps a sentence to choose
it as a line, and tips that line. The tip is marked on the line for the reader
who sent it. Writers keep 97.5% of every tip. No subscription is needed to
read or to write.

## Operating Context

- The phone is the first screen. Desktop has the same places, with a rail in
  place of the bar.
- **Today** (`/`) opens on real text: one article, then a short stream. **Read
  more** continues the article at the paragraph where Today stopped.
- **The article** (`/{username}/{slug}`) has a tip bar. Tapping a sentence
  chooses it as a line; the bar then offers **Keep**, **Share** and **Clear**,
  the amount, and **Tip this line $1**. A tap on text never pays; only the tip
  button, which states its amount, sends.
- **Balance** opens over whatever the reader is doing (a sheet on a phone, a
  panel on desktop). It shows what the reader can tip, the activity, and adding
  money.
- **Shelf** holds reading places and kept lines. **Write** holds drafts and the
  editor. **You** holds the profile and sign-out.
- Signed out, a reader can read everything, choose lines and set an amount.
  Signing in is asked for only when the reader keeps a line, tips, or publishes,
  and the reader returns to the same line afterwards.
- Reading works with scripts off. Signing in and tipping need scripts.

## Capabilities and Constraints

- **Stellar testnet only.** Every payment runs on Stellar testnet with
  practice money that has no value. Describe testnet activity as testnet
  activity, in the product and outside it.
- **Fee split.** Writers receive 97.5% of each tip; Quilltip receives 2.5%.
- **The balance.** A reader's balance is held in lumens (XLM) and shown in
  dollars. A converted figure carries "≈"; a tip amount, a button, a receipt
  and an activity row never do. Amounts are exact, with two decimals in rows
  and more where the exact amount is the point.
- **When money shows.** At the press, the balance drops by exactly the tip.
  The count, the mark on the line and **Sent** come only when Quilltip accepts
  the tip. A refused tip returns the exact amount in place, with one plain
  sentence.
- **Quick tips.** "Quick tips: tip from your balance on this device without
  approving each tip." They have a limit and an end time, both shown before the
  reader agrees. Where a wallet's prompt shows the limit in XLM, the product
  shows the same XLM figure with the dollar estimate beside it.
  The reader can turn them off in Balance, and signing out turns them off on
  that device.
- **Custody.** Quilltip can never move a reader's money. An email restores the
  profile, never a balance.
- **Adding money.** Money is added inside Balance, or from the tip that
  needs it, from a Stellar testnet wallet, and the reader comes back to the
  same line. One approval adds the money and can set up or renew quick tips;
  the reader may add money only. The review states the amount in dollars and
  XLM, the network's charge and who pays it, and the approval's limit and end
  before the wallet is asked. Adding money never sends a tip, and never
  cancels a withdrawal without saying so on its own button.
- **Limits.** Tip limits are set in dollars: $5 a tip and $20 a day, and the
  tip opens at $1 at any XLM price. A quick-tips approval allows at most the
  balance or $50, whichever is smaller.
- **Publishing and tips are two steps.** An article is live when published;
  tips on it start after the writer's wallet registers it.
- **Permanent copies.** A writer can choose to store a permanent copy of an
  article on Arweave at publish. It is off by default and cannot be deleted
  afterwards.
- **Not built yet:**
  - A passkey account for newcomers: a first tip with one system prompt and $5
    of testnet practice money from Quilltip, with no wallet, and practice money
    again once a day. When it ships, it becomes the default way to a first tip
    on a phone, and a wallet becomes the second way to add money.
  - Following writers.
- **Terminology.** Published content is **articles**; article links say
  **Read more**. A chosen sentence is a **line**. Use **tip**, not
  "micro-tip". The reader sees **Balance**, never "Pocket" or "Tab". These
  words never appear to a reader: tab, voucher, settle, deposit, contract,
  ledger, gas, mint, NFT, token. "Fee" appears in the 97.5% line, and as "Network fee" where a reader's own wallet pays Stellar's charge.

## Brand Commitments

- The name is written **Quilltip**, with one capital letter, also at the start
  of a sentence and in headings.
- Voice: minimal copy, short sentences, plain words. Remove each word, control
  and element that is not necessary. Every sentence about money must be true.
- Headline: "Writing you can tip, down to the sentence." Writer line: "Writers
  keep 97.5% of every tip."
- The testnet line: "Quilltip runs on Stellar testnet. Tips are practice
  money." It appears at the foot of Today, at the foot of Balance, and where
  money first comes in.
- The page is quiet and bookish. It does not look like a crypto app.

## Evidence on Hand

- The demo video and demo account in `README.md` show the product before the
  current rebuild.
- Testnet contract IDs are in `docs/contracts/v3-testnet-deployment.md`.
- The design system and its rules are in `system/README.md`, with every
  component in every state at `/system`.
- No testimonials, customer names, usage figures or press are on hand. Do not
  invent them, and do not invent tip counts or earnings for real writers.

## Product Principles

1. Reading comes first. Nothing moves the words under the reader, and every
   money act happens in a sheet over the text and returns to the same place.
2. The tip is the main action: one tap on a button that states its amount.
3. Tell the truth about money: exact figures, "≈" only on converted figures,
   nothing shown as sent before it is accepted, and testnet said as testnet.
4. Each approval allows exactly what its label says, and its limit and end are
   shown before the reader agrees.
5. Less is more. Remove what is not necessary.

## Accessibility & Inclusion

- Text contrast at least 4.5:1 in both themes. A mark on a line never rests
  on colour alone: it keeps an underline, a tick or a count.
- Every control at least 44 px; the tip button at least 52 px.
- Reduced motion: no smooth scroll and no growth animations; state changes
  still show.
- Inputs at 16 px or more, so phones do not zoom.
- Amounts are spoken in words ("1 dollar", "40 cents", "about 18 dollars 40"),
  never as the "≈" glyph.
