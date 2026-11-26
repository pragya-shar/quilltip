//! Storage keys, types and accessors (`02-core-contract.md`, sections 2.1 and 2.3).
//!
//! Every persistent write extends the written entry with the shared TTL policy.

use quilltip_shared::{ttl, DAY};
use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env, Vec};

use crate::errors::CoreError;

pub const MAX_RECIPIENTS: u32 = 5;
pub const MAX_TOKENS: u32 = 4;
pub const MAX_BATCH_ITEMS: u32 = 10;
/// Σ over batch items of (recipients + 1 treasury transfer).
pub const MAX_BATCH_TRANSFERS: u32 = 24;
pub const TIP_REF_TTL: u32 = DAY;
/// Longest author-change proposal, in ledgers.
pub const MAX_PROPOSAL_LIFETIME: u32 = 30 * DAY;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Split {
    pub recipient: Address,
    pub bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArticleRecord {
    /// Primary recipient; receives the rounding remainder.
    pub author: Address,
    pub content_hash: BytesN<32>,
    pub arweave_id: Option<BytesN<32>>,
    /// 1 at registration, +1 per `update_content`.
    pub content_version: u32,
    /// Empty = 100% of net to the author.
    pub splits: Vec<Split>,
    pub registered_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenConfig {
    pub min_tip: i128,
    pub enabled: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TipInput {
    pub article_id: BytesN<32>,
    pub amount: i128,
    pub highlight_id: Option<BytesN<32>>,
    pub client_ref: BytesN<16>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Instance: `Address`.
    Treasury,
    /// Instance: `TokenConfig`.
    Token(Address),
    /// Instance: `Vec<Address>` of configured tokens, at most `MAX_TOKENS`.
    Tokens,
    /// Persistent: `ArticleRecord`.
    Article(BytesN<32>),
    /// Persistent: `i128` gross cumulative total per (article, token).
    Total(BytesN<32>, Address),
    /// Temporary: `bool`, TTL `TIP_REF_TTL`.
    TipRef(Address, BytesN<16>),
    /// Temporary: `(Address, u32)` = (new author, live until ledger).
    PendingAuthor(BytesN<32>),
}

// ---------- instance ----------

pub fn treasury(e: &Env) -> Address {
    e.storage()
        .instance()
        .get(&DataKey::Treasury)
        .expect("treasury is set in the constructor")
}

pub fn set_treasury(e: &Env, treasury: &Address) {
    e.storage().instance().set(&DataKey::Treasury, treasury);
}

pub fn token_config(e: &Env, token: &Address) -> Option<TokenConfig> {
    e.storage().instance().get(&DataKey::Token(token.clone()))
}

pub fn tokens(e: &Env) -> Vec<Address> {
    e.storage()
        .instance()
        .get(&DataKey::Tokens)
        .unwrap_or_else(|| Vec::new(e))
}

/// Inserts or updates a token. Fails with `TooManyTokens` for a new token
/// beyond `MAX_TOKENS`.
pub fn upsert_token(e: &Env, token: &Address, config: &TokenConfig) {
    let mut list = tokens(e);
    if !list.contains(token) {
        if list.len() >= MAX_TOKENS {
            panic_with_error!(e, CoreError::TooManyTokens);
        }
        list.push_back(token.clone());
        e.storage().instance().set(&DataKey::Tokens, &list);
    }
    e.storage()
        .instance()
        .set(&DataKey::Token(token.clone()), config);
}

pub fn remove_token(e: &Env, token: &Address) {
    let mut list = tokens(e);
    if let Some(index) = list.first_index_of(token) {
        list.remove(index);
    }
    e.storage().instance().set(&DataKey::Tokens, &list);
    e.storage()
        .instance()
        .remove(&DataKey::Token(token.clone()));
}

// ---------- persistent ----------

pub fn article(e: &Env, article_id: &BytesN<32>) -> Option<ArticleRecord> {
    e.storage()
        .persistent()
        .get(&DataKey::Article(article_id.clone()))
}

pub fn article_or_panic(e: &Env, article_id: &BytesN<32>) -> ArticleRecord {
    article(e, article_id).unwrap_or_else(|| panic_with_error!(e, CoreError::NotRegistered))
}

pub fn set_article(e: &Env, article_id: &BytesN<32>, record: &ArticleRecord) {
    let key = DataKey::Article(article_id.clone());
    e.storage().persistent().set(&key, record);
    ttl::extend_persistent(e, &key);
}

/// Extends an existing article entry (every tip keeps the article live).
pub fn extend_article(e: &Env, article_id: &BytesN<32>) {
    ttl::extend_persistent(e, &DataKey::Article(article_id.clone()));
}

pub fn total(e: &Env, article_id: &BytesN<32>, token: &Address) -> i128 {
    e.storage()
        .persistent()
        .get(&DataKey::Total(article_id.clone(), token.clone()))
        .unwrap_or(0)
}

pub fn set_total(e: &Env, article_id: &BytesN<32>, token: &Address, value: i128) {
    let key = DataKey::Total(article_id.clone(), token.clone());
    e.storage().persistent().set(&key, &value);
    ttl::extend_persistent(e, &key);
}

// ---------- temporary ----------

pub fn has_tip_ref(e: &Env, tipper: &Address, client_ref: &BytesN<16>) -> bool {
    e.storage()
        .temporary()
        .has(&DataKey::TipRef(tipper.clone(), client_ref.clone()))
}

pub fn set_tip_ref(e: &Env, tipper: &Address, client_ref: &BytesN<16>) {
    let key = DataKey::TipRef(tipper.clone(), client_ref.clone());
    e.storage().temporary().set(&key, &true);
    ttl::extend_temporary(e, &key, TIP_REF_TTL);
}

pub fn pending_author(e: &Env, article_id: &BytesN<32>) -> Option<(Address, u32)> {
    e.storage()
        .temporary()
        .get(&DataKey::PendingAuthor(article_id.clone()))
}

pub fn set_pending_author(
    e: &Env,
    article_id: &BytesN<32>,
    new_author: &Address,
    live_until_ledger: u32,
) {
    let key = DataKey::PendingAuthor(article_id.clone());
    e.storage()
        .temporary()
        .set(&key, &(new_author.clone(), live_until_ledger));
    let now = e.ledger().sequence();
    ttl::extend_temporary(e, &key, ttl::ledgers_until(now, live_until_ledger));
}

pub fn remove_pending_author(e: &Env, article_id: &BytesN<32>) {
    e.storage()
        .temporary()
        .remove(&DataKey::PendingAuthor(article_id.clone()));
}
