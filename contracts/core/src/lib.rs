//! QuillTip Core contract: article registry, co-author splits and direct tips.
//!
//! Specification: `docs/architecture/v2/02-core-contract.md`, with the shared
//! conventions in `01-architecture.md` (sections 1.4 and 1.5) and the
//! invariants in `07-security-and-recovery.md` (section 7.1).
#![no_std]

mod contract;
mod errors;
mod events;
mod split;
mod storage;

#[cfg(test)]
mod test;

pub use contract::{QuillTipCore, QuillTipCoreClient, PAUSER_ROLE, SCHEMA_VERSION, UPGRADER_ROLE};
pub use errors::CoreError;
pub use events::*;
pub use storage::{
    ArticleRecord, Split, TipInput, TokenConfig, MAX_BATCH_ITEMS, MAX_BATCH_TRANSFERS,
    MAX_PROPOSAL_LIFETIME, MAX_RECIPIENTS, MAX_TOKENS, TIP_REF_TTL,
};

soroban_sdk::contractmeta!(key = "name", val = "quilltip-core");
soroban_sdk::contractmeta!(key = "version", val = env!("CARGO_PKG_VERSION"));
soroban_sdk::contractmeta!(key = "schema_version", val = "1");
