# 7. Agent payments

Software agents pay to read an article and can tip, over HTTP, with the
Stellar MPP handshake. The writer is credited with the same 97.5% split as a
human tip, enforced on chain.

Package: A3 ([work packages](work-packages.md#later-waves)).

## 7.1 Constraints from the rails

- MPP's HTTP flow: `402` with `WWW-Authenticate: Payment …` (the challenge),
  a retry with `Authorization: Payment …` (the credential), `200` with
  `Payment-Receipt`.
- MPP `charge` on Stellar is exactly one token `transfer` to one recipient,
  with no sub-invocations. It cannot split a payment and cannot call Core or
  the Tab. Its payer must be a classic account. The `session` intent's
  channel contract pays one payee per channel.
- The Tab is already a multi-payee channel with ed25519 keys and the split
  enforced at settlement.

## 7.2 Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | **Agents pay through the Tab.** An agent is a Tab reader with its own address and key. Each read or tip is a voucher, accepted by the same Convex code as a human balance tip, settled by the same settler.                                                                                                                                 |
| M2  | The handshake uses the `402` / `Authorization: Payment` header shape with our own method, `method="quilltip-tab"`, and a small published client signs vouchers. Docs and UI call this **Quilltip agent payments**. We claim compatibility with standard MPP or x402 only after the flow passes with an independent client we did not write. |
| M3  | The endpoints are **Next.js route handlers** (`app/api/agent/**`); each calls one Convex function that does every check, so the rules live in one place.                                                                                                                                                                                    |
| M4  | Writers choose per profile: `agentAccess` (`paid` or `off`, default `paid`) and `agentPriceCents` (default 1). Articles stay free for people.                                                                                                                                                                                               |
| M5  | No custodial hop. A standard MPP `charge` pays one address with one transfer, so the only path that keeps the platform out of custody is a payment straight to the writer, which carries no platform fee. It is designed (7.6) and not built.                                                                                               |

## 7.3 Agent accounts

An agent registers once:

1. `POST /api/agent/register` with its address and a signature over a server
   challenge (`agents.challenge`, then `agents.register`), the same message
   signing proof as a wallet link. Convex creates a `users` row with
   `kind: 'agent'` (no email, no password) and sets the address as verified.
2. The agent opens a Tab session from its own account:
   `Tab.open_session(agent, amount, agentKey, valid_until, spend_limit)`,
   paying its own fee, or through the fee sponsor with the per-user limits
   of [section 5.3](05-accounts.md#53-fee-sponsor). It then calls
   `POST /api/agent/transactions` with the hash (`balance.recordTransaction`
   for the agent user); the key is usable after verification by hash.
3. `GET /api/agent/session` returns the agent's balance and key state, as
   `balance.session` does for a person.

A paid request is authenticated by the voucher signature itself: a voucher
verifies only under a key registered on chain for the agent's Tab account.
Registration, session reads and the challenge's pair state use a bearer
token issued at registration (`agentTokens`, stored hashed).

## 7.4 HTTP surface

```text
POST /api/agent/register                     address + signature → bearer token
POST /api/agent/transactions                 record a Tab transaction hash
GET  /api/agent/session                      balance and key state
GET  /api/agent/articles/{slug}              read an article (402 until paid)
POST /api/agent/tips                         tip an article or passage
GET  /api/agent                              machine-readable index
```

Read flow:

1. Unknown or unpublished slug: `404`. Writer has `agentAccess: off`: `403`.
2. No credential: `402` with
   `WWW-Authenticate: Payment method="quilltip-tab", intent="session", request="<base64 JSON>"`.
   The JSON is
   `{ tab, token, writer, articleKey, contentHash, amount, network: "stellar:testnet", pair }`,
   where `pair` (`{ seq, segment, cumulative, leafHashes }`) is this agent's
   state with this writer. Without a bearer token the challenge omits `pair`
   and points to `/api/agent/register`.
3. The agent builds the receipt, signs the voucher (the client library wraps
   the `lib/stellar/v2/tab` encoders) and retries with
   `Authorization: Payment <base64 JSON { receipt, signature, keyId, requestId }>`.
4. The handler calls `agents.acceptRead` (section 7.5). On acceptance it
   answers `200` with `Payment-Receipt: <base64 JSON { receiptId, cumulative }>`
   and the article as JSON:
   `{ title, author: { name, username }, publishedAt, url, contentMarkdown }`.
   A changed pair answers `402` again with the fresh pair state.

Tip flow: `POST /api/agent/tips` with `{ articleId, passageId?, amountCents }`
and the same credential; `204` with the receipt. Amount limits are the
balance limits of [section 1.3](01-tip-pipeline.md#13-limits), with
`AGENT_TIP_MAX_CENTS` (default $20) per tip.

Discovery: article pages carry
`<link rel="alternate" type="application/json" href="/api/agent/articles/{slug}">`;
`/api/agent` lists the endpoints, the method, the network and the client
library's package name.

Testnet guard: the handlers refuse to start unless the configured network
is testnet; challenges name `stellar:testnet` only.

## 7.5 Crediting the writer

```ts
// convex/agents.ts (A3)
export const acceptRead = mutation({
  args: {
    agentToken: v.string(),
    articleSlug: v.string(),
    keyId: v.number(),
    requestId: v.string(),
    receipt: receiptValidator,
    signature: v.string(),
  },
  returns: v.object({ receiptId: v.id('tabReceipts'), cumulative: v.string() }),
})
// acceptTip: the same arguments with articleId, passage and amountCents.
```

- Both run the acceptance of `balance.send`
  ([section 1.4](01-tip-pipeline.md#14-the-balance-route)) with the agent
  user as the reader: the same rules, signature check, countersignature,
  receipt, activity, earnings and `requestSettlement`. A read is a receipt
  with `kind: 'read'`; a tip is a receipt as today.
- The writer's activity shows `via: 'agent'` with the counterparty "AI
  reader". Earnings move as for a balance tip: pending at acceptance, earned
  at settlement, in the writer's wallet in the same transaction
  ([section 3.5](03-settlement.md#35-automatic-payout)).
- Settlement pays 97.5% to the writer and 2.5% to the treasury under the
  cumulative fee rule, like every voucher.
- Article tip counts include agent tips; agent reads are counted apart
  (`articles.agentReadCount`). The NFT threshold counts wallet tips only, as
  in v2.

Failure cases: an agent without balance gets `402` with
`error="insufficient-balance"`; an expired or revoked key gets `402` with
`error="key"`; a voucher for another article or writer is refused; a repeat
of an accepted `requestId` returns the first receipt.

## 7.6 Standard MPP `charge` interop (designed, not built)

The path is noncustodial: no platform-held account receives an agent's
payment, and no "treasury receives 100% then pays the writer" step exists.
That leaves one design:

1. `402` from `mppx.charge({ amount, description })` with
   `recipient = the writer's payout address`, network `stellar:testnet`, and
   the token's contract as currency. The replay store is a Convex-backed
   adapter (`mppChallenges`), never the in-memory store.
2. After the SDK confirms the transfer, `agents.recordCharge` stores it once
   per challenge and transaction hash; Convex verifies the hash and credits
   the writer's activity and earnings (`via: 'agent'`, in the wallet at once).
3. No platform fee is taken on this path, so it changes the 97.5% / 2.5%
   rule for these payments. It is built only if the owner accepts that
   exception; otherwise standard clients are not served.

Build it on a release of the MPP SDK that supports Stellar SDK 17.4; the
0.7.1 release pins an older SDK.

## 7.7 Configuration

| Name                        | Where  | Meaning                     |
| --------------------------- | ------ | --------------------------- |
| `AGENT_TIP_MAX_CENTS`       | Next   | Upper bound of an agent tip |
| `AGENT_DEFAULT_PRICE_CENTS` | Convex | Default per-read price (1)  |
| `MPP_SECRET_KEY`            | Next   | Only with 7.6               |

## 7.8 Tests (A3)

- Route handlers: `402` shape with and without a bearer token; a paid read
  returns the article; a changed pair returns a fresh challenge; an `off`
  writer returns `403`; the testnet guard.
- `acceptRead` and `acceptTip` in `convex-test`: the balance acceptance rules
  hold for an agent user; idempotent on `requestId`; activity `via: 'agent'`.
- Local network: an agent opens a Tab and reads 40 articles from 5 writers;
  settlement pays each writer 97.5% of its reads.
- The client library's vouchers match the `v3.json` vectors.
