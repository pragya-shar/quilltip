//! Events. Specification: `03-tab-contract.md`, section 3.9.
//!
//! The first topic is the snake_case event name. Data is a map.

use soroban_sdk::{contractevent, Address, BytesN};

#[contractevent(data_format = "map")]
pub struct Deposited {
    #[topic]
    pub reader: Address,
    pub amount: i128,
    pub balance_after: i128,
}

#[contractevent(data_format = "map")]
pub struct KeyRegistered {
    #[topic]
    pub reader: Address,
    pub key_id: u32,
    pub public_key: BytesN<32>,
    pub valid_until: u32,
    pub spend_limit: i128,
}

#[contractevent(data_format = "map")]
pub struct KeyRevoked {
    #[topic]
    pub reader: Address,
    pub key_id: u32,
    pub valid_until: u32,
}

#[contractevent(data_format = "map")]
pub struct TabSettled {
    #[topic]
    pub reader: Address,
    #[topic]
    pub writer: Address,
    pub key_id: u32,
    pub cumulative: i128,
    pub paid_after: i128,
    pub gross: i128,
    pub fee: i128,
    pub receipts_root: BytesN<32>,
    pub by_writer: bool,
}

#[contractevent(data_format = "map")]
pub struct VoucherSkipped {
    #[topic]
    pub reader: Address,
    #[topic]
    pub writer: Address,
    pub key_id: u32,
    pub cumulative: i128,
    pub reason: u32,
}

#[contractevent(data_format = "map")]
pub struct Claimed {
    #[topic]
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent(data_format = "map")]
pub struct WithdrawStarted {
    #[topic]
    pub reader: Address,
    pub balance: i128,
    pub unlock_ledger: u32,
}

#[contractevent(data_format = "map")]
pub struct WithdrawCancelled {
    #[topic]
    pub reader: Address,
    pub balance: i128,
}

#[contractevent(data_format = "map")]
pub struct Withdrawn {
    #[topic]
    pub reader: Address,
    pub amount: i128,
}

#[contractevent(data_format = "map")]
pub struct LimitsSet {
    pub max_balance: i128,
    pub min_deposit: i128,
}

#[contractevent(data_format = "map")]
pub struct TreasurySet {
    pub previous: Address,
    pub new: Address,
}

#[contractevent(data_format = "map")]
pub struct AcceptorSet {
    pub public_key: BytesN<32>,
}

#[contractevent(data_format = "map")]
pub struct Migrated {
    pub from_version: u32,
    pub to_version: u32,
}
