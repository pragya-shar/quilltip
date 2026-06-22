# Unified Tipping Contract Testnet Deploy

Public deployment note for the upgraded unified tipping contract used by article tips, highlight tips, and batch settlement on Stellar Testnet.

## Deployment

| Field                  | Value                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Network                | Stellar Testnet                                                                                           |
| Contract ID            | `CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY`                                                |
| Stellar Expert         | https://stellar.expert/explorer/testnet/contract/CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY |
| Source commit          | `a3f45eaa931c1edc8957b6b8ee0f013e68cf16a9`                                                                |
| WASM SHA-256           | `e7f12f0258adfca279897d96e5864f62f5499bebda8185315cd391c71b9dfb5b`                                        |
| Deploy transaction     | `86b998c3691acad05becaeba13907410cffe80a05d6e02b185feb881aa22ecd3`                                        |
| Initialize transaction | `1576cb5afaf2410a73c11d283ef53eea69f059a318d85de782c1dccb366c3412`                                        |

## Configuration

The frontend and backend must point at the same contract:

| Surface        | Key                               |
| -------------- | --------------------------------- |
| Frontend       | `NEXT_PUBLIC_TIPPING_CONTRACT_ID` |
| Convex backend | `TIPPING_CONTRACT_ID`             |

The platform fee recipient is configured separately through `NEXT_PUBLIC_PLATFORM_ADDRESS`.

## Contract Surface

The deployed unified contract handles the active tipping paths:

- Article tips: `tip_article`
- Highlight tips: `tip_highlight_direct`
- Article batch settlement: `batch_tip`
- Highlight batch settlement: `batch_tip_highlights`
