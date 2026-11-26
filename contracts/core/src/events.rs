//! Events (`02-core-contract.md`, section 2.4). Data is a map unless noted.
//! The first topic is the snake_case event name.

use soroban_sdk::{contractevent, Address, BytesN, Vec};

use crate::storage::Split;

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArticleRegistered {
    #[topic]
    pub article_id: BytesN<32>,
    #[topic]
    pub author: Address,
    pub content_hash: BytesN<32>,
    pub arweave_id: Option<BytesN<32>>,
    pub splits: Vec<Split>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentUpdated {
    #[topic]
    pub article_id: BytesN<32>,
    pub content_hash: BytesN<32>,
    pub arweave_id: Option<BytesN<32>>,
    pub content_version: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SplitsSet {
    #[topic]
    pub article_id: BytesN<32>,
    pub splits: Vec<Split>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorProposed {
    #[topic]
    pub article_id: BytesN<32>,
    pub new_author: Address,
    pub live_until_ledger: u32,
}

/// Not listed in section 2.4. Section 1.5 requires one event per state change,
/// and `cancel_author_proposal` removes the pending entry.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorProposalCancelled {
    #[topic]
    pub article_id: BytesN<32>,
    pub new_author: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorChanged {
    #[topic]
    pub article_id: BytesN<32>,
    pub previous: Address,
    pub new: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Tipped {
    #[topic]
    pub article_id: BytesN<32>,
    #[topic]
    pub author: Address,
    pub tipper: Address,
    pub token: Address,
    pub gross: i128,
    pub fee: i128,
    pub net: i128,
    pub highlight_id: Option<BytesN<32>>,
    pub content_hash: BytesN<32>,
    pub content_version: u32,
    pub client_ref: BytesN<16>,
    pub total_after: i128,
    pub split_count: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenSet {
    #[topic]
    pub token: Address,
    pub min_tip: i128,
    pub enabled: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenRemoved {
    #[topic]
    pub token: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasurySet {
    pub previous: Option<Address>,
    pub new: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Migrated {
    pub from_version: u32,
    pub to_version: u32,
}
