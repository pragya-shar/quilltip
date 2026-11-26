//! QuillTip Tab contract: prepaid reader tabs, session-key vouchers and batched settlement.
//!
//! Specification: `docs/architecture/v2/03-tab-contract.md`.
//! This crate is a skeleton. The contract issue fills in the entry points,
//! storage, events and errors.
#![no_std]

mod contract;

#[cfg(test)]
mod test;

pub use contract::QuillTipTab;

soroban_sdk::contractmeta!(key = "name", val = "quilltip-tab");
soroban_sdk::contractmeta!(key = "version", val = env!("CARGO_PKG_VERSION"));
soroban_sdk::contractmeta!(key = "schema_version", val = "1");
