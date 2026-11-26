//! Shared building blocks for the QuillTip v2 contracts.
//!
//! Specification: `docs/architecture/v2/01-architecture.md` (sections 1.4 and 1.5),
//! `02-core-contract.md`, `03-tab-contract.md` and `04-nft-contract.md`.
//!
//! This crate is an `rlib` only. It holds no contract and no storage of its own.
//!
//! - [`constants`]: ledger time, TTL policy, fee basis points, Tab signing domains.
//! - [`errors`]: the error-code range reserved for each contract.
//! - [`ids`]: identifier types and their on-chain derivations.
//! - [`ttl`]: TTL extension helpers that apply the shared policy.
//! - [`fee`]: checked fee and split arithmetic.
//! - [`payload`]: `TipReceipt`, `VoucherPayload` and `AcceptancePayload` and their signed bytes.
//! - [`merkle`]: receipt leaves, Merkle roots and proofs.
#![no_std]

pub mod constants;
pub mod errors;
pub mod fee;
pub mod ids;
pub mod merkle;
pub mod payload;
pub mod roles;
pub mod ttl;

pub use constants::*;
pub use ids::{ArticleId, ArweaveId, ClientRef, ContentHash, HighlightId, ReceiptsRoot};
pub use payload::{AcceptancePayload, TipReceipt, VoucherPayload};
