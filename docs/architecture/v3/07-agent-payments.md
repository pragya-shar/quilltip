# 7. Agent payments

Software agents pay to read an article and can tip, over HTTP, with Stellar
MPP. The writer is credited with the same 97.5% split as a human tip.

Package: A3 ([work packages](work-packages.md#later-waves)).

## 7.1 What MPP gives

From the Stellar MPP documentation (`@stellar/mpp` with `mppx`): the server
answers `402 Payment Required` with a payment challenge (currency, amount,
recipient, network); the client pays and retries with a credential; the
server verifies, and answers `200` with a receipt. Two intents exist:

- **charge**: each request is one Stellar Asset Contract `transfer` to the
  challenge's recipient, settled on chain individually. In the default
  "pull" mode the client signs the transaction and the server simulates,
  checks the transfer, broadcasts and waits for confirmation.
- **session**: a one-way payment channel contract with off-chain cumulative
  commitments, closed by the server.

The documented examples use USDC on testnet (`stellar:testnet`). The
server SDK works on the Web `Request` and `Response` types. Its example store
(`Store.memory()`) does not persist across server instances.

## 7.2 Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | v3 uses the **charge** intent. The session intent's channel duplicates the Tab for agents; it is a later step once agents read at volume.                                                                                                                                                                                              |
| M2  | The endpoint is a **Next.js route handler** (Node runtime), `app/api/agents/articles/[slug]/route.ts`. The SDK targets standard `Request`/`Response` on Node; a Convex HTTP action would need a second hop into a Node action for the SDK.                                                                                             |
| M3  | The challenge's recipient is a platform **agent gateway** account. After the payment confirms, Convex forwards it with `Core.tip` from the gateway account, so the 97.5% / 2.5% split happens on chain in Core as for every wallet tip. The gateway holds an agent's payment for at most one forwarding cycle (target under a minute). |
| M4  | The SDK's replay store is a Convex-backed adapter (`mppChallenges` table), never the memory store.                                                                                                                                                                                                                                     |
| M5  | The agent pays its own network fee (pull mode without sponsorship). Quilltip pays only the forwarding transactions.                                                                                                                                                                                                                    |
| M6  | Asset: USDC on testnet at first (the documented asset); further SAC tokens when the registry enables them ([document 6](06-assets.md)), subject to the SDK accepting them.                                                                                                                                                             |
| M7  | Writers choose per profile: `agentAccess` (`paid` or `off`, default `paid`) and `agentPriceCents`, default 5. Articles stay free for people.                                                                                                                                                                                           |

## 7.3 HTTP surface

```text
GET  /api/agents/articles/{slug}             read an article
POST /api/agents/articles/{slug}/tip         tip, body { "amountCents": 100 }
GET  /api/agents                             machine-readable index: endpoint, assets, network, prices
```

Read flow:

1. Unknown or unpublished slug: `404`. Writer has `agentAccess: 'off'`: `403`
   with a short JSON reason.
2. No credential: `402` with the challenge from
   `mppx.charge({ amount, description })`, amount = `agentPriceCents` in
   USDC, recipient = `AGENT_GATEWAY_ADDRESS`, network `stellar:testnet`, and
   `description` naming the article and writer.
3. Credential present: the SDK verifies and broadcasts. On confirmation, the
   handler calls `agents.recordPayment` (section 7.4), then answers `200` with
   the SDK's receipt and the article as JSON:
   `{ title, author: { name, username }, publishedAt, url, contentMarkdown, license }`.
4. A credential for another article, an expired challenge or a reused
   challenge is refused by the SDK with its own status; the store makes
   reuse visible across instances (M4).

Tip flow: the same, with the amount from the body (between the token's
minimum and `AGENT_TIP_MAX_CENTS`, default $20), and `204` with the receipt.

Discovery: article pages carry
`<link rel="alternate" type="application/json" href="/api/agents/articles/{slug}">`
and `/api/agents` lists the surface. `robots.txt` is unchanged.

Testnet guard: the handler refuses to start when the configured network is
not testnet (the same guard as the rest of the app), and challenges name
`stellar:testnet` only.

## 7.4 Crediting the writer

```ts
// convex/agents.ts (A3); called by the route handler with the gateway secret
export const recordPayment = mutation({
  args: {
    gatewayToken: v.string(), // AGENT_GATEWAY_TOKEN, compared in constant time
    challengeId: v.string(),
    kind: v.union(v.literal('read'), v.literal('tip')),
    articleSlug: v.string(),
    payer: v.string(), // the agent's address
    token: v.string(),
    amountBaseUnits: v.string(),
    amountCents: v.number(),
    txHash: v.string(),
  },
  returns: v.object({ paymentId: v.id('agentPayments') }),
})
```

1. `recordPayment` stores the payment once per `challengeId` and `txHash`
   (`agentPayments` table), writes the writer's activity row (`via: 'agent'`,
   counterparty "AI reader" with the payer's short address) and adds the
   writer's share to `incomingCents`. It schedules verification of `txHash`
   by Convex (the route handler's confirmation is not trusted alone) and the
   forwarder.
2. **Forwarder** (`agents.forward`, internal action, debounced 15 s like the
   settler, under an `agent-forwarder` lease): takes up to 10 verified
   payments and sends `Core.tip_batch` from the gateway account, one item per
   payment, `client_ref = sha256(challengeId)[0..16]`, `highlight_id` none.
   The batch respects Core's transfer limit (`MAX_BATCH_TRANSFERS`).
3. The `Tipped` events confirm through the v2 path
   (`coreEventHandlers`); the forwarded tip row links to the payment
   (`tips.agentPaymentId`), so the writer's figures move from incoming to
   earned and paid out as for a wallet tip ([section 2.3](02-instant-state.md#23-wallet-tips)).
4. Article tip counts and the NFT threshold count forwarded tips like other
   Core tips; the tipper on chain is the gateway account, and Convex records
   the agent as the payer.

Failure cases: a forward that fails on chain is retried with the same
`client_ref` (Core refuses a duplicate, so a retry cannot pay twice); an
article whose payout address changed between payment and forward is
forwarded to the current address, as Core resolves the author at tip time;
an article removed after payment is flagged for review and its payment is
refunded from the gateway by an operator action.

## 7.5 Configuration

| Name                    | Where  | Meaning                                                                     |
| ----------------------- | ------ | --------------------------------------------------------------------------- |
| `MPP_SECRET_KEY`        | Next   | The SDK's challenge key                                                     |
| `AGENT_GATEWAY_ADDRESS` | Next   | Challenge recipient                                                         |
| `AGENT_GATEWAY_TOKEN`   | both   | Shared secret for `agents.recordPayment`                                    |
| `AGENT_GATEWAY_SECRET`  | Convex | The gateway account key, read only by the forwarder after the network guard |
| `AGENT_TIP_MAX_CENTS`   | Next   | Upper bound of an agent tip                                                 |

## 7.6 Tests (A3)

- Route handler with the SDK's client against the local network: `402`
  shape, paid read returns the article, a reused credential is refused, an
  `off` writer returns `403`.
- Store adapter: two handler instances share replay protection.
- `recordPayment`: idempotent on `challengeId`; wrong token refused;
  activity and incoming written once.
- Forwarder: batches up to 10, retries with the same `client_ref`, the
  writer receives 97.5% on chain and the treasury 2.5%.
- Testnet run with the SDK client: pay, read, tip; writer's earnings move
  within a minute.
