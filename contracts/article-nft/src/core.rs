//! The part of the Core read interface that the NFT uses
//! (`docs/architecture/v2/02-core-contract.md`, section 2.2, Views).

use soroban_sdk::{contractclient, Address, BytesN, Env};

/// Core views read by `mint`. Core implements these with exactly these
/// signatures.
#[contractclient(name = "CoreClient")]
pub trait CoreReader {
    /// The article's current author. Core panics with `NotRegistered`
    /// (`CoreError` 1) when the article is not registered.
    fn article_author(e: Env, article_id: BytesN<32>) -> Address;

    /// The article's gross cumulative direct tip total in `token`, or `0`.
    fn article_total(e: Env, article_id: BytesN<32>, token: Address) -> i128;
}
