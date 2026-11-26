//! QuillTip Core contract: article registry, co-author splits and direct tips.
//!
//! Specification: `docs/architecture/v2/02-core-contract.md`.
//! This crate is a skeleton. The contract issue fills in the entry points,
//! storage, events and errors.
#![no_std]

mod contract;

#[cfg(test)]
mod test;

pub use contract::QuillTipCore;

soroban_sdk::contractmeta!(key = "name", val = "quilltip-core");
soroban_sdk::contractmeta!(key = "version", val = env!("CARGO_PKG_VERSION"));
soroban_sdk::contractmeta!(key = "schema_version", val = "1");
