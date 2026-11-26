//! Entry points (`02-core-contract.md`, section 2.2).

use quilltip_shared::{ids, ttl, FEE_BPS, MIN_FEE_BEARING_AMOUNT};
use soroban_sdk::{
    contract, contractimpl, panic_with_error, token, Address, BytesN, Env, MuxedAddress, Symbol,
    Vec,
};
use stellar_access::access_control::{self as access_control, AccessControl};
use stellar_contract_utils::pausable::{self as pausable, Pausable};
use stellar_contract_utils::upgradeable::{self as upgradeable, Upgradeable};
use stellar_macros::{only_admin, only_role, when_not_paused};

use crate::errors::CoreError;
use crate::events::{
    ArticleRegistered, AuthorChanged, AuthorProposalCancelled, AuthorProposed, ContentUpdated,
    Migrated, SplitsSet, Tipped, TokenRemoved, TokenSet, TreasurySet,
};
use crate::split;
use crate::storage::{
    self, ArticleRecord, Split, TipInput, TokenConfig, MAX_BATCH_ITEMS, MAX_BATCH_TRANSFERS,
    MAX_PROPOSAL_LIFETIME,
};

/// Schema version written by the constructor and targeted by `migrate`.
#[cfg(not(feature = "upgrade-test"))]
pub const SCHEMA_VERSION: u32 = 1;
/// Test build only: a layout-compatible v2 used by the upgrade test (I-30).
#[cfg(feature = "upgrade-test")]
pub const SCHEMA_VERSION: u32 = 2;

pub const PAUSER_ROLE: &str = "pauser";
pub const UPGRADER_ROLE: &str = "upgrader";

#[contract]
pub struct QuillTipCore;

fn require_valid_hash(e: &Env, hash: &BytesN<32>) {
    if ids::is_zero(hash) {
        panic_with_error!(e, CoreError::InvalidHash);
    }
}

fn require_valid_arweave(e: &Env, arweave_id: &Option<BytesN<32>>) {
    if let Some(id) = arweave_id {
        require_valid_hash(e, id);
    }
}

fn require_min_tip(e: &Env, min_tip: i128) {
    if min_tip < MIN_FEE_BEARING_AMOUNT {
        panic_with_error!(e, CoreError::InvalidMinimum);
    }
}

/// Runs the `tip` checks in the documented order and moves one tip.
/// The caller has already checked pause and tipper authorisation.
fn tip_one(e: &Env, tipper: &Address, token: &Address, input: &TipInput) {
    let TipInput {
        article_id,
        amount,
        highlight_id,
        client_ref,
    } = input.clone();

    // 1. amount > 0
    if amount <= 0 {
        panic_with_error!(e, CoreError::InvalidAmount);
    }
    // 2. token allowed
    let config = match storage::token_config(e, token) {
        Some(c) if c.enabled => c,
        _ => panic_with_error!(e, CoreError::TokenNotAllowed),
    };
    // 3. minimum tip
    if amount < config.min_tip {
        panic_with_error!(e, CoreError::BelowMinimum);
    }
    // 4. article registered
    let record = storage::article_or_panic(e, &article_id);
    // 5. not a self-tip
    if split::is_recipient(&record.author, &record.splits, tipper) {
        panic_with_error!(e, CoreError::SelfTip);
    }
    // 6. client reference unused
    if storage::has_tip_ref(e, tipper, &client_ref) {
        panic_with_error!(e, CoreError::DuplicateClientRef);
    }

    let (fee, net, shares) = split::compute(e, &record.author, &record.splits, amount);
    let total_after = storage::total(e, &article_id, token)
        .checked_add(amount)
        .unwrap_or_else(|| panic_with_error!(e, CoreError::Overflow));

    let client = token::TokenClient::new(e, token);
    for (recipient, share) in shares.iter() {
        if share > 0 {
            client.transfer(tipper, MuxedAddress::from(recipient), &share);
        }
    }
    client.transfer(tipper, MuxedAddress::from(storage::treasury(e)), &fee);

    storage::set_total(e, &article_id, token, total_after);
    storage::extend_article(e, &article_id);
    storage::set_tip_ref(e, tipper, &client_ref);

    Tipped {
        article_id,
        author: record.author,
        tipper: tipper.clone(),
        token: token.clone(),
        gross: amount,
        fee,
        net,
        highlight_id,
        content_hash: record.content_hash,
        content_version: record.content_version,
        client_ref,
        total_after,
        split_count: record.splits.len(),
    }
    .publish(e);
}

#[contractimpl]
impl QuillTipCore {
    pub fn __constructor(
        e: &Env,
        admin: Address,
        pauser: Address,
        upgrader: Address,
        treasury: Address,
        token: Address,
        min_tip: i128,
    ) {
        require_min_tip(e, min_tip);

        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(e, &pauser, &Symbol::new(e, PAUSER_ROLE), &admin);
        access_control::grant_role_no_auth(e, &upgrader, &Symbol::new(e, UPGRADER_ROLE), &admin);

        storage::set_treasury(e, &treasury);
        let config = TokenConfig {
            min_tip,
            enabled: true,
        };
        storage::upsert_token(e, &token, &config);
        upgradeable::set_schema_version(e, SCHEMA_VERSION);
        ttl::extend_instance(e);

        TokenSet {
            token,
            min_tip,
            enabled: true,
        }
        .publish(e);
        TreasurySet {
            previous: None,
            new: treasury,
        }
        .publish(e);
    }

    // ---------------- Article registration ----------------

    #[when_not_paused]
    pub fn register_article(
        e: &Env,
        author: Address,
        article_id: BytesN<32>,
        content_hash: BytesN<32>,
        arweave_id: Option<BytesN<32>>,
        splits: Vec<Split>,
    ) {
        author.require_auth();
        if storage::article(e, &article_id).is_some() {
            panic_with_error!(e, CoreError::AlreadyRegistered);
        }
        require_valid_hash(e, &article_id);
        require_valid_hash(e, &content_hash);
        require_valid_arweave(e, &arweave_id);
        split::validate(e, &author, &storage::treasury(e), &splits);

        let record = ArticleRecord {
            author: author.clone(),
            content_hash: content_hash.clone(),
            arweave_id: arweave_id.clone(),
            content_version: 1,
            splits: splits.clone(),
            registered_ledger: e.ledger().sequence(),
        };
        storage::set_article(e, &article_id, &record);
        ttl::extend_instance(e);

        ArticleRegistered {
            article_id,
            author,
            content_hash,
            arweave_id,
            splits,
        }
        .publish(e);
    }

    #[when_not_paused]
    pub fn update_content(
        e: &Env,
        article_id: BytesN<32>,
        content_hash: BytesN<32>,
        arweave_id: Option<BytesN<32>>,
    ) {
        let mut record = storage::article_or_panic(e, &article_id);
        record.author.require_auth();
        require_valid_hash(e, &content_hash);
        require_valid_arweave(e, &arweave_id);

        record.content_version = record
            .content_version
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(e, CoreError::Overflow));
        record.content_hash = content_hash.clone();
        record.arweave_id = arweave_id.clone();
        storage::set_article(e, &article_id, &record);
        ttl::extend_instance(e);

        ContentUpdated {
            article_id,
            content_hash,
            arweave_id,
            content_version: record.content_version,
        }
        .publish(e);
    }

    #[when_not_paused]
    pub fn set_splits(e: &Env, article_id: BytesN<32>, splits: Vec<Split>) {
        let mut record = storage::article_or_panic(e, &article_id);
        record.author.require_auth();
        split::validate(e, &record.author, &storage::treasury(e), &splits);

        record.splits = splits.clone();
        storage::set_article(e, &article_id, &record);
        ttl::extend_instance(e);

        SplitsSet { article_id, splits }.publish(e);
    }

    #[when_not_paused]
    pub fn propose_author(
        e: &Env,
        article_id: BytesN<32>,
        new_author: Address,
        live_until_ledger: u32,
    ) {
        let record = storage::article_or_panic(e, &article_id);
        record.author.require_auth();
        if new_author == record.author
            || new_author == storage::treasury(e)
            || split::is_recipient(&record.author, &record.splits, &new_author)
        {
            panic_with_error!(e, CoreError::SameAuthor);
        }
        let now = e.ledger().sequence();
        if live_until_ledger <= now || live_until_ledger > now.saturating_add(MAX_PROPOSAL_LIFETIME)
        {
            panic_with_error!(e, CoreError::InvalidExpiry);
        }

        storage::set_pending_author(e, &article_id, &new_author, live_until_ledger);
        storage::extend_article(e, &article_id);
        ttl::extend_instance(e);

        AuthorProposed {
            article_id,
            new_author,
            live_until_ledger,
        }
        .publish(e);
    }

    #[when_not_paused]
    pub fn accept_author(e: &Env, article_id: BytesN<32>) {
        let (new_author, live_until_ledger) = storage::pending_author(e, &article_id)
            .unwrap_or_else(|| panic_with_error!(e, CoreError::NoPendingAuthor));
        if e.ledger().sequence() > live_until_ledger {
            panic_with_error!(e, CoreError::NoPendingAuthor);
        }
        new_author.require_auth();

        let mut record = storage::article_or_panic(e, &article_id);
        let previous = record.author.clone();
        record.author = new_author.clone();
        if !record.splits.is_empty() {
            let mut first = record.splits.get_unchecked(0);
            first.recipient = new_author.clone();
            record.splits.set(0, first);
        }
        // Splits or the treasury may have changed since the proposal.
        split::validate(e, &record.author, &storage::treasury(e), &record.splits);

        storage::set_article(e, &article_id, &record);
        storage::remove_pending_author(e, &article_id);
        ttl::extend_instance(e);

        AuthorChanged {
            article_id,
            previous,
            new: new_author,
        }
        .publish(e);
    }

    /// Allowed while paused: it only removes a pending proposal.
    pub fn cancel_author_proposal(e: &Env, article_id: BytesN<32>) {
        let record = storage::article_or_panic(e, &article_id);
        record.author.require_auth();
        let (new_author, _) = storage::pending_author(e, &article_id)
            .unwrap_or_else(|| panic_with_error!(e, CoreError::NoPendingAuthor));

        storage::remove_pending_author(e, &article_id);
        ttl::extend_instance(e);

        AuthorProposalCancelled {
            article_id,
            new_author,
        }
        .publish(e);
    }

    // ---------------- Tipping ----------------

    #[when_not_paused]
    pub fn tip(
        e: &Env,
        tipper: Address,
        article_id: BytesN<32>,
        token: Address,
        amount: i128,
        highlight_id: Option<BytesN<32>>,
        client_ref: BytesN<16>,
    ) {
        tipper.require_auth();
        tip_one(
            e,
            &tipper,
            &token,
            &TipInput {
                article_id,
                amount,
                highlight_id,
                client_ref,
            },
        );
        ttl::extend_instance(e);
    }

    #[when_not_paused]
    pub fn tip_batch(e: &Env, tipper: Address, token: Address, items: Vec<TipInput>) {
        tipper.require_auth();

        let len = items.len();
        if len == 0 {
            panic_with_error!(e, CoreError::BatchEmpty);
        }
        if len > MAX_BATCH_ITEMS {
            panic_with_error!(e, CoreError::BatchTooLarge);
        }

        // Σ (recipients + 1). An unregistered article counts one recipient;
        // its item then fails with `NotRegistered`.
        let mut transfers: u32 = 0;
        for item in items.iter() {
            let recipients = storage::article(e, &item.article_id)
                .map(|r| split::recipient_count(&r.splits))
                .unwrap_or(1);
            transfers += recipients + 1;
        }
        if transfers > MAX_BATCH_TRANSFERS {
            panic_with_error!(e, CoreError::BatchTooLarge);
        }

        for i in 0..len {
            let a = items.get_unchecked(i).client_ref;
            for j in 0..i {
                if items.get_unchecked(j).client_ref == a {
                    panic_with_error!(e, CoreError::DuplicateClientRef);
                }
            }
        }

        for item in items.iter() {
            tip_one(e, &tipper, &token, &item);
        }
        ttl::extend_instance(e);
    }

    // ---------------- Views ----------------

    pub fn get_article(e: &Env, article_id: BytesN<32>) -> Option<ArticleRecord> {
        storage::article(e, &article_id)
    }

    pub fn article_author(e: &Env, article_id: BytesN<32>) -> Address {
        storage::article_or_panic(e, &article_id).author
    }

    pub fn article_total(e: &Env, article_id: BytesN<32>, token: Address) -> i128 {
        storage::total(e, &article_id, &token)
    }

    pub fn token_config(e: &Env, token: Address) -> Option<TokenConfig> {
        storage::token_config(e, &token)
    }

    pub fn min_tip(e: &Env, token: Address) -> i128 {
        match storage::token_config(e, &token) {
            Some(c) if c.enabled => c.min_tip,
            _ => panic_with_error!(e, CoreError::TokenNotAllowed),
        }
    }

    pub fn fee_bps(_e: &Env) -> u32 {
        FEE_BPS
    }

    pub fn treasury(e: &Env) -> Address {
        storage::treasury(e)
    }

    pub fn schema_version(e: &Env) -> u32 {
        upgradeable::get_schema_version(e)
    }

    /// Test build only: proves that upgraded code is running (I-30).
    #[cfg(feature = "upgrade-test")]
    pub fn upgrade_test_marker(_e: &Env) -> u32 {
        SCHEMA_VERSION
    }

    // ---------------- Administration ----------------

    #[only_admin]
    pub fn set_token(e: &Env, token: Address, min_tip: i128, enabled: bool) {
        require_min_tip(e, min_tip);
        storage::upsert_token(e, &token, &TokenConfig { min_tip, enabled });
        ttl::extend_instance(e);

        TokenSet {
            token,
            min_tip,
            enabled,
        }
        .publish(e);
    }

    #[only_admin]
    pub fn remove_token(e: &Env, token: Address) {
        match storage::token_config(e, &token) {
            None => panic_with_error!(e, CoreError::TokenNotAllowed),
            Some(c) if c.enabled => panic_with_error!(e, CoreError::TokenEnabled),
            Some(_) => {}
        }
        storage::remove_token(e, &token);
        ttl::extend_instance(e);

        TokenRemoved { token }.publish(e);
    }

    #[only_admin]
    pub fn set_treasury(e: &Env, treasury: Address) {
        let previous = storage::treasury(e);
        storage::set_treasury(e, &treasury);
        ttl::extend_instance(e);

        TreasurySet {
            previous: Some(previous),
            new: treasury,
        }
        .publish(e);
    }

    /// Runs once per schema version (I-30). Fails with `AlreadyMigrated` when
    /// the stored version is not below `SCHEMA_VERSION`.
    #[only_role(operator, "upgrader")]
    pub fn migrate(e: &Env, operator: Address) {
        let from_version = upgradeable::get_schema_version(e);
        if from_version >= SCHEMA_VERSION {
            panic_with_error!(e, CoreError::AlreadyMigrated);
        }
        upgradeable::set_schema_version(e, SCHEMA_VERSION);
        ttl::extend_instance(e);

        Migrated {
            from_version,
            to_version: SCHEMA_VERSION,
        }
        .publish(e);
    }
}

#[contractimpl]
impl Upgradeable for QuillTipCore {
    #[only_role(operator, "upgrader")]
    fn upgrade(e: &Env, new_wasm_hash: BytesN<32>, operator: Address) {
        ttl::extend_instance(e);
        upgradeable::upgrade(e, &new_wasm_hash);
    }
}

#[contractimpl(contracttrait)]
impl Pausable for QuillTipCore {
    #[only_role(caller, "pauser")]
    fn pause(e: &Env, caller: Address) {
        pausable::pause(e);
        ttl::extend_instance(e);
    }

    /// The admin unpauses (`01-architecture.md`, section 1.5).
    fn unpause(e: &Env, caller: Address) {
        if access_control::get_admin(e) != Some(caller.clone()) {
            panic_with_error!(e, access_control::AccessControlError::Unauthorized);
        }
        caller.require_auth();
        pausable::unpause(e);
        ttl::extend_instance(e);
    }
}

/// OpenZeppelin access control. State-changing functions also extend the
/// instance TTL (I-25); `renounce_admin` always fails (I-26).
#[contractimpl(contracttrait)]
impl AccessControl for QuillTipCore {
    fn grant_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        access_control::grant_role(e, &account, &role, &caller);
        ttl::extend_instance(e);
    }

    fn revoke_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        access_control::revoke_role(e, &account, &role, &caller);
        ttl::extend_instance(e);
    }

    fn renounce_role(e: &Env, role: Symbol, caller: Address) {
        access_control::renounce_role(e, &role, &caller);
        ttl::extend_instance(e);
    }

    fn transfer_admin_role(e: &Env, new_admin: Address, live_until_ledger: u32) {
        access_control::transfer_admin_role(e, &new_admin, live_until_ledger);
        ttl::extend_instance(e);
    }

    fn accept_admin_transfer(e: &Env) {
        access_control::accept_admin_transfer(e);
        ttl::extend_instance(e);
    }

    fn set_role_admin(e: &Env, role: Symbol, admin_role: Symbol) {
        access_control::set_role_admin(e, &role, &admin_role);
        ttl::extend_instance(e);
    }

    fn renounce_admin(e: &Env) {
        panic_with_error!(e, CoreError::AdminRenounceDisabled);
    }
}
