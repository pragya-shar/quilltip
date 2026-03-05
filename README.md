# Quilltip - Decentralized Publishing Platform

<div align="center">

[![quilltip.me](https://img.shields.io/badge/quilltip.me-blue?style=flat)](https://quilltip.me)
[![CI](https://img.shields.io/github/actions/workflow/status/pragya-shar/quilltip/ci.yml?branch=development&style=flat&label=CI)](https://github.com/pragya-shar/quilltip/actions/workflows/ci.yml)
[![Tipping Contract](https://img.shields.io/badge/Tipping_Contract-yellow?style=flat&logo=stellar)](https://stellar.expert/explorer/testnet/contract/CASU4I45DVK3ZMXA3T34A3XF3BM4NBTFDW3QVCB3XA7PIWJSTN4HCVWG) [![NFT Contract](https://img.shields.io/badge/NFT_Contract-yellow?style=flat&logo=stellar)](https://stellar.expert/explorer/testnet/contract/CAS44OQK7A6W5FDRAH3K3ZN7TTQTJ5ESRVG6MB2HBVFWZ5TVH26UUB4S)

![Next.js](https://img.shields.io/badge/Next.js-000?style=flat&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06b6d4?style=flat&logo=tailwindcss&logoColor=white)
![Convex](https://img.shields.io/badge/Convex-ff6b35?style=flat&logo=convex&logoColor=white)
![Stellar](https://img.shields.io/badge/Stellar-7c3aed?style=flat&logo=stellar&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000?style=flat&logo=rust&logoColor=white)

</div>

## Demo

<div align="center">

[![Watch Demo](https://img.youtube.com/vi/OqOkbAm9_T8/maxresdefault.jpg)](https://youtu.be/OqOkbAm9_T8?si=onogkL495LIzwaki)

_Click to watch the demo_

</div>

| Email              | Password     |
| ------------------ | ------------ |
| `demo@example.com` | `Stellar123` |

## Overview

Quilltip is a decentralized publishing platform where writers earn money through reader tips. Built with Next.js 16, Convex backend, Stellar blockchain for payments, and Arweave for permanent content storage. Writers receive 97.5% of every tip — no subscriptions, no minimum payouts.

## Key Features

- **Direct Payments**: Authors receive 97.5% of tips via Stellar
- **Permanent Storage**: Articles stored forever on Arweave blockchain
- **Free Access**: No subscription required to read or write
- **Real-time Features**: Live tips and text highlights
- **NFT Support**: Articles can be minted as NFTs
- **Microtipping**: Tip highlights for as low as $0.01

### For Writers

- **Rich Text Editor** — headings, lists, code blocks, image uploads, YouTube embeds, syntax highlighting, auto-save, draft management
- **Analytics Dashboard** — real-time earnings, article performance, reader engagement, tip history
- **NFT Minting** — automatic eligibility after tip threshold, one-click minting, full ownership and transfer rights

### For Readers

- **Interactive Reading** — text highlighting with notes, public/private annotations, color-coded highlights, persistent across sessions
- **Microtipping** — support authors with $0.01–$100, preset amounts, instant Stellar transactions
- **Content Discovery** — full-text search, tag-based filtering, author collections, trending articles

### For Collectors

- **Article NFTs** — unique digital collectibles, transferable ownership, on-chain provenance, future marketplace integration

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Copy env template
cp .env.example .env.local

# 3. Initialize Convex (auto-populates CONVEX_DEPLOYMENT + NEXT_PUBLIC_CONVEX_URL)
bunx convex dev --once

# 4. Set auth URL on Convex deployment
bunx convex env set SITE_URL http://localhost:3000

# 5. Start dev server (Next.js + Convex in parallel)
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). See [docs/SETUP.md](docs/SETUP.md) for full environment details.

## Documentation

| Document                                     | Description                                            |
| -------------------------------------------- | ------------------------------------------------------ |
| [docs/SETUP.md](docs/SETUP.md)               | Full setup guide, environment variables, prerequisites |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Tech stack, project structure, database schema         |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)     | Production builds, Vercel, Convex deploy               |
| [CONTRIBUTING.md](CONTRIBUTING.md)           | How to contribute — workflow, code style, PR process   |
| [SECURITY.md](SECURITY.md)                   | Security policy and vulnerability reporting            |

## Status

- **Stage**: Beta
- **Network**: Stellar Testnet
- **Database**: Convex Cloud
- **Hosting**: Vercel

## Support

- **Issues**: [github.com/pragya-shar/quilltip/issues](https://github.com/pragya-shar/quilltip/issues)

## License

[MIT](LICENSE)

---

[![Twitter](https://img.shields.io/badge/@Quilltip__me-000?style=flat&logo=x&logoColor=white)](https://x.com/Quilltip_me)

**Quilltip** — Writers keep 97.5%. Readers tip what they want. Built on Stellar.
