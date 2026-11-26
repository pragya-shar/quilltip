//! QuillTip Article NFT contract: one NFT per article, minted at a Core tip threshold.
//!
//! Specification: `docs/architecture/v2/04-nft-contract.md`.
//! This crate is a skeleton. The contract issue fills in the entry points,
//! storage, events and errors.
#![no_std]

mod contract;

#[cfg(test)]
mod test;

pub use contract::QuillTipArticleNft;

soroban_sdk::contractmeta!(key = "name", val = "quilltip-article-nft");
soroban_sdk::contractmeta!(key = "version", val = env!("CARGO_PKG_VERSION"));
soroban_sdk::contractmeta!(key = "schema_version", val = "1");
