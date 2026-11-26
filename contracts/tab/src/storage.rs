//! Types, constants and storage keys. Specification: `03-tab-contract.md`, sections 3.1 and 3.3.

use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env, Vec};

use quilltip_shared::constants::DAY;
use quilltip_shared::ttl;

use crate::errors::TabError;

/// Maximum vouchers in one `settle` or `settle_own` call.
pub const MAX_SETTLE_BATCH: u32 = 32;
/// Maximum session-key lifetime, in ledgers from registration.
pub const MAX_KEY_LIFETIME: u32 = 30 * DAY;
/// Ledgers after `valid_until` during which accepted vouchers can still settle.
pub const SETTLE_GRACE: u32 = 7 * DAY;
/// Ledgers between `withdraw_start` and the first ledger `withdraw` succeeds.
pub const WITHDRAW_DELAY: u32 = 3 * DAY;
/// Acceptor keys kept: the current key and the previous one.
pub const MAX_ACCEPTOR_KEYS: u32 = 2;
/// Schema version written by the constructor.
pub const SCHEMA_VERSION: u32 = 1;

/// `VoucherSkipped.reason`: no session key with this `key_id` (or it expired from storage).
pub const SKIP_KEY_UNKNOWN: u32 = 1;
/// `VoucherSkipped.reason`: the key's settle window has ended.
pub const SKIP_KEY_EXPIRED: u32 = 2;
/// `VoucherSkipped.reason`: `cumulative <= Paid`.
pub const SKIP_STALE: u32 = 3;
/// `VoucherSkipped.reason`: nothing is payable (balance or spend limit exhausted).
pub const SKIP_SHORTFALL: u32 = 4;
/// `VoucherSkipped.reason`: `settle_own` without a valid acceptor.
pub const SKIP_NOT_ACCEPTED: u32 = 5;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TabConfig {
    pub token: Address,
    pub treasury: Address,
    pub max_balance: i128,
    pub min_deposit: i128,
    /// ed25519 acceptor public keys: `[current, previous]`.
    pub acceptor_keys: Vec<BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReaderAccount {
    pub balance: i128,
    pub next_key_id: u32,
    /// 0 when no withdrawal is pending.
    pub withdraw_unlock: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionKey {
    pub public_key: BytesN<32>,
    pub valid_until: u32,
    pub spend_limit: i128,
    pub spent: i128,
    pub revoked: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Voucher {
    pub reader: Address,
    pub writer: Address,
    pub key_id: u32,
    pub cumulative: i128,
    pub receipts_root: BytesN<32>,
    /// Session-key signature over the voucher payload.
    pub signature: BytesN<64>,
    /// Acceptor public key (one of `acceptor_keys`). Required by `settle_own`; ignored by `settle`.
    pub acceptor: Option<BytesN<32>>,
    /// Acceptor signature over the acceptance payload. Present exactly when `acceptor` is.
    pub acceptance_signature: Option<BytesN<64>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettleSummary {
    pub settled: u32,
    pub skipped: u32,
    pub gross: i128,
    pub fee: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum TabKey {
    Config,
    Account(Address),
    Claimable(Address),
    Session(Address, u32),
    Paid(Address, u32, Address),
}

pub fn config(e: &Env) -> TabConfig {
    e.storage()
        .instance()
        .get(&TabKey::Config)
        .unwrap_or_else(|| panic!("config is set by the constructor"))
}

pub fn set_config(e: &Env, config: &TabConfig) {
    e.storage().instance().set(&TabKey::Config, config);
}

pub fn account(e: &Env, reader: &Address) -> Option<ReaderAccount> {
    e.storage()
        .persistent()
        .get(&TabKey::Account(reader.clone()))
}

/// Writes an account. Accounts are never removed (I-28).
pub fn set_account(e: &Env, reader: &Address, account: &ReaderAccount) {
    let key = TabKey::Account(reader.clone());
    e.storage().persistent().set(&key, account);
    ttl::extend_persistent(e, &key);
}

pub fn claimable(e: &Env, owner: &Address) -> i128 {
    e.storage()
        .persistent()
        .get(&TabKey::Claimable(owner.clone()))
        .unwrap_or(0)
}

pub fn add_claimable(e: &Env, owner: &Address, amount: i128) {
    if amount == 0 {
        return;
    }
    let key = TabKey::Claimable(owner.clone());
    let next = claimable(e, owner)
        .checked_add(amount)
        .unwrap_or_else(|| panic_with_error!(e, TabError::Overflow));
    e.storage().persistent().set(&key, &next);
    ttl::extend_persistent(e, &key);
}

pub fn take_claimable(e: &Env, owner: &Address) -> i128 {
    let key = TabKey::Claimable(owner.clone());
    let amount = claimable(e, owner);
    if amount != 0 {
        e.storage().persistent().remove(&key);
    }
    amount
}

pub fn session(e: &Env, reader: &Address, key_id: u32) -> Option<SessionKey> {
    e.storage()
        .temporary()
        .get(&TabKey::Session(reader.clone(), key_id))
}

/// Writes a session key and keeps it live until `valid_until + SETTLE_GRACE` (I-29).
pub fn set_session(e: &Env, reader: &Address, key_id: u32, key: &SessionKey) {
    let k = TabKey::Session(reader.clone(), key_id);
    e.storage().temporary().set(&k, key);
    ttl::extend_temporary(e, &k, live_ledgers(e, key.valid_until));
}

pub fn paid(e: &Env, reader: &Address, key_id: u32, writer: &Address) -> i128 {
    e.storage()
        .temporary()
        .get(&TabKey::Paid(reader.clone(), key_id, writer.clone()))
        .unwrap_or(0)
}

/// Writes `Paid` and keeps it live as long as its key (I-29).
pub fn set_paid(
    e: &Env,
    reader: &Address,
    key_id: u32,
    writer: &Address,
    amount: i128,
    valid_until: u32,
) {
    let k = TabKey::Paid(reader.clone(), key_id, writer.clone());
    e.storage().temporary().set(&k, &amount);
    ttl::extend_temporary(e, &k, live_ledgers(e, valid_until));
}

/// Last ledger a voucher under a key with `valid_until` can settle.
pub fn settle_deadline(valid_until: u32) -> u32 {
    valid_until.saturating_add(SETTLE_GRACE)
}

/// TTL that keeps a temporary entry live through `valid_until + SETTLE_GRACE`.
fn live_ledgers(e: &Env, valid_until: u32) -> u32 {
    ttl::ledgers_until(e.ledger().sequence(), settle_deadline(valid_until))
}
