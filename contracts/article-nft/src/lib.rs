//! QuillTip Article NFT contract: one NFT per article, minted at a Core tip threshold.
//!
//! Specification: `docs/architecture/v2/04-nft-contract.md`.
//!
//! - Built on OpenZeppelin `stellar-tokens` 0.8.0 `NonFungibleToken` with
//!   `ContractType = Compose<(Base, Royalties)>`.
//! - `mint` reads the article author and the article's tip total from Core and
//!   enforces the threshold itself (I-19).
//! - The royalty is 1,000 bps to the minting author, set at mint and never
//!   changed (I-20).
#![no_std]

#[cfg(test)]
extern crate std;

mod contract;
mod core;
mod errors;
mod events;
mod storage;

#[cfg(test)]
mod test;

pub use contract::{QuillTipArticleNft, QuillTipArticleNftClient};
pub use core::{CoreClient, CoreReader};
pub use errors::NftError;
pub use events::{ArticleNftMinted, NftMigrated, ThresholdSet};
pub use storage::{NAME, PAUSER_ROLE, ROYALTY_BPS, SCHEMA_VERSION, SYMBOL, UPGRADER_ROLE};

soroban_sdk::contractmeta!(key = "name", val = "quilltip-article-nft");
soroban_sdk::contractmeta!(key = "version", val = env!("CARGO_PKG_VERSION"));
soroban_sdk::contractmeta!(key = "schema_version", val = "1");
