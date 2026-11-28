use quilltip_shared::ttl::{extend_instance, extend_persistent};
use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env};
use stellar_tokens::non_fungible::NFTStorageKey;

use crate::errors::NftError;

/// Royalty in basis points, to the minting author (I-20).
pub const ROYALTY_BPS: u32 = 1_000;
/// Schema version written by the constructor and targeted by `migrate`.
pub const SCHEMA_VERSION: u32 = 1;
/// OpenZeppelin metadata.
pub const NAME: &str = "QuillTip Article";
pub const SYMBOL: &str = "QTART";
/// Role names (`docs/architecture/v2/01-architecture.md`, section 1.5).
pub const PAUSER_ROLE: &str = "pauser";
pub const UPGRADER_ROLE: &str = "upgrader";

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Core contract address, fixed at construction. Instance.
    Core,
    /// Token whose Core total is compared with the threshold. Instance.
    ThresholdToken,
    /// Threshold in the token's base units. Instance.
    Threshold,
    /// Token ID minted for an article. Persistent.
    MintedArticle(BytesN<32>),
    /// Article an NFT was minted for. Persistent.
    TokenArticle(u32),
}

/// Mirror of the OpenZeppelin royalties storage key, which the library does
/// not export. A `#[contracttype]` enum is stored as its variant name and
/// fields, so this key addresses the same ledger entry. Used only to extend
/// the TTL of the royalty entry that `mint` writes.
#[contracttype]
#[derive(Clone)]
pub enum NFTRoyaltiesStorageKey {
    DefaultRoyalty,
    TokenRoyalty(u32),
}

pub fn core(e: &Env) -> Address {
    e.storage().instance().get(&DataKey::Core).unwrap()
}

pub fn set_core(e: &Env, core: &Address) {
    e.storage().instance().set(&DataKey::Core, core);
}

pub fn threshold(e: &Env) -> (Address, i128) {
    let token = e
        .storage()
        .instance()
        .get(&DataKey::ThresholdToken)
        .unwrap();
    let threshold = e.storage().instance().get(&DataKey::Threshold).unwrap();
    (token, threshold)
}

pub fn set_threshold(e: &Env, token: &Address, threshold: i128) {
    if threshold <= 0 {
        panic_with_error!(e, NftError::InvalidThreshold);
    }
    e.storage().instance().set(&DataKey::ThresholdToken, token);
    e.storage().instance().set(&DataKey::Threshold, &threshold);
}

pub fn token_of_article(e: &Env, article_id: &BytesN<32>) -> Option<u32> {
    e.storage()
        .persistent()
        .get(&DataKey::MintedArticle(article_id.clone()))
}

pub fn article_of_token(e: &Env, token_id: u32) -> Option<BytesN<32>> {
    e.storage()
        .persistent()
        .get(&DataKey::TokenArticle(token_id))
}

/// Records the article and token pair and extends both entries.
pub fn record_mint(e: &Env, article_id: &BytesN<32>, token_id: u32) {
    let minted = DataKey::MintedArticle(article_id.clone());
    let token = DataKey::TokenArticle(token_id);
    e.storage().persistent().set(&minted, &token_id);
    e.storage().persistent().set(&token, article_id);
    extend_persistent(e, &minted);
    extend_persistent(e, &token);
}

/// Extends the OpenZeppelin entries that `mint` writes: the owner, the
/// author's balance and the token royalty (I-25). The token counter is in
/// instance storage.
pub fn extend_minted_token(e: &Env, token_id: u32, owner: &Address) {
    extend_persistent(e, &NFTStorageKey::Owner(token_id));
    extend_persistent(e, &NFTStorageKey::Balance(owner.clone()));
    extend_persistent(e, &NFTRoyaltiesStorageKey::TokenRoyalty(token_id));
    extend_instance(e);
}

/// Extends the OpenZeppelin entries that a transfer writes: the owner and both
/// balances (I-25). OpenZeppelin keeps a zero balance entry, so both exist.
pub fn extend_transferred_token(e: &Env, token_id: u32, from: &Address, to: &Address) {
    extend_persistent(e, &NFTStorageKey::Owner(token_id));
    extend_persistent(e, &NFTStorageKey::Balance(from.clone()));
    extend_persistent(e, &NFTStorageKey::Balance(to.clone()));
    extend_instance(e);
}
