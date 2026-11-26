//! Tab contract entry points. Specification: `03-tab-contract.md`, section 3.2.

use soroban_sdk::{
    contract, contractimpl, panic_with_error, symbol_short, token::TokenClient, Address, Bytes,
    BytesN, Env, Symbol, Vec,
};
use stellar_access::access_control::{self as access_control, AccessControl};
use stellar_contract_utils::pausable::{self as pausable, Pausable};
use stellar_contract_utils::upgradeable::{self as upgradeable, Upgradeable};
use stellar_macros::{only_admin, only_role, when_not_paused};

use quilltip_shared::fee::tab_fee;
use quilltip_shared::ids::is_zero;
use quilltip_shared::payload::{AcceptancePayload, VoucherPayload};
use quilltip_shared::roles;
use quilltip_shared::ttl;

use crate::errors::TabError;
use crate::events::{
    AcceptorSet, Claimed, Deposited, KeyRegistered, KeyRevoked, LimitsSet, Migrated, TabSettled,
    TreasurySet, VoucherSkipped, WithdrawCancelled, WithdrawStarted, Withdrawn,
};
use crate::storage::{
    self, ReaderAccount, SessionKey, SettleSummary, TabConfig, Voucher, MAX_ACCEPTOR_KEYS,
    MAX_KEY_LIFETIME, MAX_SETTLE_BATCH, SCHEMA_VERSION, SKIP_KEY_EXPIRED, SKIP_KEY_UNKNOWN,
    SKIP_NOT_ACCEPTED, SKIP_SHORTFALL, SKIP_STALE, WITHDRAW_DELAY,
};

/// Role that may pause.
pub const ROLE_PAUSER: Symbol = symbol_short!("pauser");
/// Role that may upgrade and migrate.
pub const ROLE_UPGRADER: Symbol = symbol_short!("upgrader");
/// Role that may call `settle`.
pub const ROLE_SETTLER: Symbol = symbol_short!("settler");

#[contract]
pub struct QuillTipTab;

fn err(e: &Env, error: TabError) -> ! {
    panic_with_error!(e, error)
}

fn checked_add(e: &Env, a: i128, b: i128) -> i128 {
    a.checked_add(b)
        .unwrap_or_else(|| err(e, TabError::Overflow))
}

fn checked_sub(e: &Env, a: i128, b: i128) -> i128 {
    a.checked_sub(b)
        .unwrap_or_else(|| err(e, TabError::Overflow))
}

fn validate_limits(e: &Env, max_balance: i128, min_deposit: i128) {
    if min_deposit <= 0 || min_deposit > max_balance {
        err(e, TabError::InvalidLimits);
    }
}

fn empty_account() -> ReaderAccount {
    ReaderAccount {
        balance: 0,
        next_key_id: 0,
        withdraw_unlock: 0,
    }
}

/// The exact bytes a session key signs for this voucher.
fn payload_bytes(
    e: &Env,
    reader: &Address,
    writer: &Address,
    key_id: u32,
    public_key: &BytesN<32>,
    cumulative: i128,
    receipts_root: &BytesN<32>,
) -> Bytes {
    VoucherPayload::new(
        e,
        e.current_contract_address(),
        e.ledger().network_id(),
        reader.clone(),
        writer.clone(),
        key_id,
        public_key.clone(),
        cumulative,
        receipts_root.clone(),
    )
    .to_bytes(e)
}

fn do_deposit(e: &Env, cfg: &TabConfig, reader: &Address, amount: i128) {
    if amount < cfg.min_deposit {
        err(e, TabError::BelowMinimumDeposit);
    }
    let mut acct = storage::account(e, reader).unwrap_or_else(empty_account);
    let balance_after = checked_add(e, acct.balance, amount);
    if balance_after > cfg.max_balance {
        err(e, TabError::BalanceCapExceeded);
    }
    TokenClient::new(e, &cfg.token).transfer(reader, e.current_contract_address(), &amount);
    acct.balance = balance_after;
    let cancelled = acct.withdraw_unlock != 0;
    acct.withdraw_unlock = 0;
    storage::set_account(e, reader, &acct);
    if cancelled {
        WithdrawCancelled {
            reader: reader.clone(),
            balance: balance_after,
        }
        .publish(e);
    }
    Deposited {
        reader: reader.clone(),
        amount,
        balance_after,
    }
    .publish(e);
}

fn check_key_args(e: &Env, public_key: &BytesN<32>, valid_until: u32, spend_limit: i128) {
    let now = e.ledger().sequence();
    if valid_until <= now || valid_until > now.saturating_add(MAX_KEY_LIFETIME) {
        err(e, TabError::InvalidKeyExpiry);
    }
    if is_zero(public_key) || spend_limit <= 0 {
        err(e, TabError::InvalidKey);
    }
}

fn do_register_key(
    e: &Env,
    reader: &Address,
    public_key: BytesN<32>,
    valid_until: u32,
    spend_limit: i128,
) -> u32 {
    let mut acct = storage::account(e, reader).unwrap_or_else(empty_account);
    let key_id = acct.next_key_id;
    acct.next_key_id = key_id
        .checked_add(1)
        .unwrap_or_else(|| err(e, TabError::Overflow));
    storage::set_account(e, reader, &acct);
    let key = SessionKey {
        public_key: public_key.clone(),
        valid_until,
        spend_limit,
        spent: 0,
        revoked: false,
    };
    storage::set_session(e, reader, key_id, &key);
    KeyRegistered {
        reader: reader.clone(),
        key_id,
        public_key,
        valid_until,
        spend_limit,
    }
    .publish(e);
    key_id
}

fn skip(e: &Env, v: &Voucher, reason: u32, summary: &mut SettleSummary) {
    summary.skipped += 1;
    VoucherSkipped {
        reader: v.reader.clone(),
        writer: v.writer.clone(),
        key_id: v.key_id,
        cumulative: v.cumulative,
        reason,
    }
    .publish(e);
}

/// The acceptor key and signature, when both are present and the key is current or previous.
fn valid_acceptance(cfg: &TabConfig, v: &Voucher) -> Option<(BytesN<32>, BytesN<64>)> {
    let acceptor = v.acceptor.clone()?;
    let signature = v.acceptance_signature.clone()?;
    if cfg.acceptor_keys.contains(&acceptor) {
        Some((acceptor, signature))
    } else {
        None
    }
}

/// Settles a batch. `writer` is `Some` for `settle_own`.
fn settle_batch(e: &Env, vouchers: &Vec<Voucher>, writer: Option<&Address>) -> SettleSummary {
    let n = vouchers.len();
    if n == 0 {
        err(e, TabError::BatchEmpty);
    }
    if n > MAX_SETTLE_BATCH {
        err(e, TabError::BatchTooLarge);
    }
    if let Some(w) = writer {
        for v in vouchers.iter() {
            if &v.writer != w {
                err(e, TabError::WrongWriter);
            }
        }
    }
    let cfg = storage::config(e);
    let now = e.ledger().sequence();
    let mut summary = SettleSummary {
        settled: 0,
        skipped: 0,
        gross: 0,
        fee: 0,
    };
    for v in vouchers.iter() {
        // 1. Key exists.
        let Some(mut key) = storage::session(e, &v.reader, v.key_id) else {
            skip(e, &v, SKIP_KEY_UNKNOWN, &mut summary);
            continue;
        };
        // 2. Settle window (I-15).
        if now > storage::settle_deadline(key.valid_until) {
            skip(e, &v, SKIP_KEY_EXPIRED, &mut summary);
            continue;
        }
        // 3. Monotonic cumulative (I-11).
        let paid = storage::paid(e, &v.reader, v.key_id, &v.writer);
        if v.cumulative <= paid {
            skip(e, &v, SKIP_STALE, &mut summary);
            continue;
        }
        // settle_own: a known acceptor key is required (I-18).
        let acceptance = if writer.is_some() {
            match valid_acceptance(&cfg, &v) {
                Some(a) => Some(a),
                None => {
                    skip(e, &v, SKIP_NOT_ACCEPTED, &mut summary);
                    continue;
                }
            }
        } else {
            None
        };
        // 4. Session-key signature (I-14). An invalid signature traps.
        let msg = payload_bytes(
            e,
            &v.reader,
            &v.writer,
            v.key_id,
            &key.public_key,
            v.cumulative,
            &v.receipts_root,
        );
        e.crypto()
            .ed25519_verify(&key.public_key, &msg, &v.signature);
        if let Some((acceptor, signature)) = acceptance {
            let accept = AcceptancePayload::for_voucher_bytes(e, &msg).to_bytes(e);
            e.crypto().ed25519_verify(&acceptor, &accept, &signature);
        }
        // 5. Account (I-28).
        let mut acct =
            storage::account(e, &v.reader).unwrap_or_else(|| err(e, TabError::AccountMissing));
        // 6. Payable amount (I-12).
        let delta = checked_sub(e, v.cumulative, paid);
        let headroom = checked_sub(e, key.spend_limit, key.spent);
        let gross = delta.min(acct.balance).min(headroom);
        if gross <= 0 {
            skip(e, &v, SKIP_SHORTFALL, &mut summary);
            continue;
        }
        // 7. Cumulative fee rule (I-13, I-31).
        let fee = tab_fee(paid, gross).unwrap_or_else(|| err(e, TabError::Overflow));
        let net = checked_sub(e, gross, fee);
        let paid_after = checked_add(e, paid, gross);
        // 8 and 9. State.
        storage::set_paid(
            e,
            &v.reader,
            v.key_id,
            &v.writer,
            paid_after,
            key.valid_until,
        );
        acct.balance = checked_sub(e, acct.balance, gross);
        storage::set_account(e, &v.reader, &acct);
        key.spent = checked_add(e, key.spent, gross);
        storage::set_session(e, &v.reader, v.key_id, &key);
        storage::add_claimable(e, &v.writer, net);
        summary.settled += 1;
        summary.gross = checked_add(e, summary.gross, gross);
        summary.fee = checked_add(e, summary.fee, fee);
        // 10. Event.
        TabSettled {
            reader: v.reader.clone(),
            writer: v.writer.clone(),
            key_id: v.key_id,
            cumulative: v.cumulative,
            paid_after,
            gross,
            fee,
            receipts_root: v.receipts_root.clone(),
            by_writer: writer.is_some(),
        }
        .publish(e);
    }
    storage::add_claimable(e, &cfg.treasury, summary.fee);
    ttl::extend_instance(e);
    summary
}

#[contractimpl]
impl QuillTipTab {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        e: &Env,
        admin: Address,
        pauser: Address,
        upgrader: Address,
        settler: Address,
        token: Address,
        treasury: Address,
        max_balance: i128,
        min_deposit: i128,
        acceptor_key: BytesN<32>,
    ) {
        validate_limits(e, max_balance, min_deposit);
        if is_zero(&acceptor_key) {
            err(e, TabError::InvalidKey);
        }
        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(e, &pauser, &ROLE_PAUSER, &admin);
        access_control::grant_role_no_auth(e, &upgrader, &ROLE_UPGRADER, &admin);
        access_control::grant_role_no_auth(e, &settler, &ROLE_SETTLER, &admin);
        let mut acceptor_keys = Vec::new(e);
        acceptor_keys.push_back(acceptor_key);
        storage::set_config(
            e,
            &TabConfig {
                token,
                treasury,
                max_balance,
                min_deposit,
                acceptor_keys,
            },
        );
        upgradeable::set_schema_version(e, SCHEMA_VERSION);
        ttl::extend_instance(e);
    }

    // ----- Reader operations -----

    /// Adds funds to the reader's balance and cancels a pending withdrawal.
    #[when_not_paused]
    pub fn deposit(e: &Env, reader: Address, amount: i128) {
        reader.require_auth();
        let cfg = storage::config(e);
        do_deposit(e, &cfg, &reader, amount);
        ttl::extend_instance(e);
    }

    /// Registers a session key and returns its `key_id`.
    #[when_not_paused]
    pub fn register_key(
        e: &Env,
        reader: Address,
        public_key: BytesN<32>,
        valid_until: u32,
        spend_limit: i128,
    ) -> u32 {
        reader.require_auth();
        check_key_args(e, &public_key, valid_until, spend_limit);
        let key_id = do_register_key(e, &reader, public_key, valid_until, spend_limit);
        ttl::extend_instance(e);
        key_id
    }

    /// `deposit` (when `amount > 0`) and `register_key` in one invocation.
    #[when_not_paused]
    pub fn open_session(
        e: &Env,
        reader: Address,
        amount: i128,
        public_key: BytesN<32>,
        valid_until: u32,
        spend_limit: i128,
    ) -> u32 {
        reader.require_auth();
        if amount < 0 {
            err(e, TabError::InvalidAmount);
        }
        check_key_args(e, &public_key, valid_until, spend_limit);
        if amount > 0 {
            let cfg = storage::config(e);
            do_deposit(e, &cfg, &reader, amount);
        }
        let key_id = do_register_key(e, &reader, public_key, valid_until, spend_limit);
        ttl::extend_instance(e);
        key_id
    }

    /// Revokes a key. Accepted vouchers can still settle within the grace period.
    pub fn revoke_key(e: &Env, reader: Address, key_id: u32) {
        reader.require_auth();
        let mut key =
            storage::session(e, &reader, key_id).unwrap_or_else(|| err(e, TabError::KeyNotFound));
        key.revoked = true;
        key.valid_until = key.valid_until.min(e.ledger().sequence());
        storage::set_session(e, &reader, key_id, &key);
        KeyRevoked {
            reader,
            key_id,
            valid_until: key.valid_until,
        }
        .publish(e);
        ttl::extend_instance(e);
    }

    /// Starts the withdrawal waiting period.
    pub fn withdraw_start(e: &Env, reader: Address) {
        reader.require_auth();
        let mut acct = storage::account(e, &reader)
            .filter(|a| a.balance > 0)
            .unwrap_or_else(|| err(e, TabError::NothingToWithdraw));
        if acct.withdraw_unlock != 0 {
            err(e, TabError::WithdrawPending);
        }
        let unlock_ledger = e.ledger().sequence().saturating_add(WITHDRAW_DELAY);
        acct.withdraw_unlock = unlock_ledger;
        storage::set_account(e, &reader, &acct);
        WithdrawStarted {
            reader,
            balance: acct.balance,
            unlock_ledger,
        }
        .publish(e);
        ttl::extend_instance(e);
    }

    /// Pays the whole remaining balance to the reader after the waiting period.
    pub fn withdraw(e: &Env, reader: Address) -> i128 {
        reader.require_auth();
        let mut acct = storage::account(e, &reader)
            .filter(|a| a.withdraw_unlock != 0)
            .unwrap_or_else(|| err(e, TabError::NoWithdrawPending));
        if e.ledger().sequence() < acct.withdraw_unlock {
            err(e, TabError::WithdrawLocked);
        }
        let amount = acct.balance;
        acct.balance = 0;
        acct.withdraw_unlock = 0;
        storage::set_account(e, &reader, &acct);
        if amount > 0 {
            let cfg = storage::config(e);
            TokenClient::new(e, &cfg.token).transfer(
                &e.current_contract_address(),
                &reader,
                &amount,
            );
        }
        Withdrawn { reader, amount }.publish(e);
        ttl::extend_instance(e);
        amount
    }

    // ----- Settlement -----

    /// Settles reader-signed vouchers. Settler role only.
    #[only_role(settler, "settler")]
    pub fn settle(e: &Env, settler: Address, vouchers: Vec<Voucher>) -> SettleSummary {
        settle_batch(e, &vouchers, None)
    }

    /// Settles the caller's own countersigned vouchers.
    pub fn settle_own(e: &Env, writer: Address, vouchers: Vec<Voucher>) -> SettleSummary {
        writer.require_auth();
        settle_batch(e, &vouchers, Some(&writer))
    }

    /// Pays a writer's or the treasury's claimable balance. Anyone may call;
    /// funds go only to `recipient`.
    pub fn claim(e: &Env, recipient: Address) -> i128 {
        let amount = storage::take_claimable(e, &recipient);
        if amount == 0 {
            return 0;
        }
        let cfg = storage::config(e);
        TokenClient::new(e, &cfg.token).transfer(
            &e.current_contract_address(),
            &recipient,
            &amount,
        );
        Claimed { recipient, amount }.publish(e);
        ttl::extend_instance(e);
        amount
    }

    // ----- Views -----

    pub fn account(e: &Env, reader: Address) -> Option<ReaderAccount> {
        storage::account(e, &reader)
    }

    pub fn session_key(e: &Env, reader: Address, key_id: u32) -> Option<SessionKey> {
        storage::session(e, &reader, key_id)
    }

    pub fn paid(e: &Env, reader: Address, key_id: u32, writer: Address) -> i128 {
        storage::paid(e, &reader, key_id, &writer)
    }

    pub fn claimable(e: &Env, owner: Address) -> i128 {
        storage::claimable(e, &owner)
    }

    /// The exact bytes a session key signs for these voucher fields.
    pub fn voucher_payload(
        e: &Env,
        reader: Address,
        writer: Address,
        key_id: u32,
        cumulative: i128,
        receipts_root: BytesN<32>,
    ) -> Bytes {
        let key =
            storage::session(e, &reader, key_id).unwrap_or_else(|| err(e, TabError::KeyNotFound));
        payload_bytes(
            e,
            &reader,
            &writer,
            key_id,
            &key.public_key,
            cumulative,
            &receipts_root,
        )
    }

    pub fn config(e: &Env) -> TabConfig {
        storage::config(e)
    }

    pub fn schema_version(e: &Env) -> u32 {
        upgradeable::get_schema_version(e)
    }

    // ----- Administration -----

    #[only_admin]
    pub fn set_limits(e: &Env, max_balance: i128, min_deposit: i128) {
        validate_limits(e, max_balance, min_deposit);
        let mut cfg = storage::config(e);
        cfg.max_balance = max_balance;
        cfg.min_deposit = min_deposit;
        storage::set_config(e, &cfg);
        LimitsSet {
            max_balance,
            min_deposit,
        }
        .publish(e);
        ttl::extend_instance(e);
    }

    #[only_admin]
    pub fn set_treasury(e: &Env, treasury: Address) {
        let mut cfg = storage::config(e);
        let previous = cfg.treasury.clone();
        cfg.treasury = treasury.clone();
        storage::set_config(e, &cfg);
        TreasurySet {
            previous,
            new: treasury,
        }
        .publish(e);
        ttl::extend_instance(e);
    }

    /// Makes `public_key` the current acceptor key and keeps the previous current key.
    #[only_admin]
    pub fn set_acceptor(e: &Env, public_key: BytesN<32>) {
        if is_zero(&public_key) {
            err(e, TabError::InvalidKey);
        }
        let mut cfg = storage::config(e);
        let mut keys = Vec::new(e);
        keys.push_back(public_key.clone());
        if let Some(current) = cfg.acceptor_keys.first() {
            if keys.len() < MAX_ACCEPTOR_KEYS {
                keys.push_back(current);
            }
        }
        cfg.acceptor_keys = keys;
        storage::set_config(e, &cfg);
        AcceptorSet { public_key }.publish(e);
        ttl::extend_instance(e);
    }

    /// Runs the storage migrations up to `SCHEMA_VERSION`, once per version (I-30).
    #[only_role(operator, "upgrader")]
    pub fn migrate(e: &Env, operator: Address) {
        let from_version = upgradeable::get_schema_version(e);
        if from_version >= SCHEMA_VERSION {
            err(e, TabError::AlreadyMigrated);
        }
        // Schema 1 is the first layout; no data moves. Later versions add steps here.
        upgradeable::set_schema_version(e, SCHEMA_VERSION);
        Migrated {
            from_version,
            to_version: SCHEMA_VERSION,
        }
        .publish(e);
        ttl::extend_instance(e);
    }
}

#[contractimpl]
impl Pausable for QuillTipTab {
    fn paused(e: &Env) -> bool {
        pausable::paused(e)
    }

    /// Blocks `deposit`, `open_session` and `register_key` only (I-27).
    #[only_role(caller, "pauser")]
    fn pause(e: &Env, caller: Address) {
        pausable::pause(e);
    }

    #[only_admin]
    fn unpause(e: &Env, _caller: Address) {
        pausable::unpause(e);
    }
}

#[contractimpl]
impl Upgradeable for QuillTipTab {
    #[only_role(operator, "upgrader")]
    fn upgrade(e: &Env, new_wasm_hash: BytesN<32>, operator: Address) {
        upgradeable::upgrade(e, &new_wasm_hash);
    }
}

/// OpenZeppelin access control. Only an upgrader can change the `upgrader`
/// role (`quilltip_shared::roles`).
#[contractimpl(contracttrait)]
impl AccessControl for QuillTipTab {
    fn grant_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        roles::grant_role(e, &account, &role, &caller);
        ttl::extend_instance(e);
    }

    fn revoke_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        roles::revoke_role(e, &account, &role, &caller);
        ttl::extend_instance(e);
    }

    fn set_role_admin(e: &Env, role: Symbol, admin_role: Symbol) {
        roles::set_role_admin(e, &role, &admin_role);
        ttl::extend_instance(e);
    }

    /// Disabled: a renounce would leave a pause permanent (I-26).
    fn renounce_admin(e: &Env) {
        err(e, TabError::AdminRenounceDisabled)
    }
}
