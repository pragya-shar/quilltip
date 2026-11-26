use soroban_sdk::{contractevent, Address, BytesN};

/// Emitted by `mint`, next to the OpenZeppelin `mint` and `set_token_royalty` events.
#[contractevent(data_format = "map")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArticleNftMinted {
    #[topic]
    pub article_id: BytesN<32>,
    #[topic]
    pub author: Address,
    pub token_id: u32,
    pub total_at_mint: i128,
}

/// Emitted by `set_threshold`.
#[contractevent(data_format = "map")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThresholdSet {
    pub token: Address,
    pub threshold: i128,
}

/// Emitted by `migrate`. Named apart from Core's `Migrated`, because event
/// type names are unique across the QuillTip contracts.
#[contractevent(data_format = "map")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NftMigrated {
    pub from_version: u32,
    pub to_version: u32,
}
