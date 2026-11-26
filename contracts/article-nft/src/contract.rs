use quilltip_shared::{roles, ttl::extend_instance};
use soroban_sdk::{
    contract, contractimpl, panic_with_error, Address, BytesN, Env, String, Symbol, Vec,
};
use stellar_access::access_control::{self, AccessControl, AccessControlError};
use stellar_contract_utils::{
    pausable::{self, Pausable},
    upgradeable::{self, Upgradeable},
};
use stellar_macros::{only_admin, only_role};
use stellar_tokens::non_fungible::{
    royalties::{NonFungibleRoyalties, Royalties, RoyaltySupport},
    Base, Compose, MintOverrides, NonFungibleToken,
};

use crate::{
    core::CoreClient,
    errors::NftError,
    events::{ArticleNftMinted, NftMigrated, ThresholdSet},
    storage::{self, NAME, PAUSER_ROLE, ROYALTY_BPS, SCHEMA_VERSION, SYMBOL, UPGRADER_ROLE},
};

type ContractType = Compose<(Base, Royalties)>;

#[contract]
pub struct QuillTipArticleNft;

#[contractimpl]
impl QuillTipArticleNft {
    /// Sets the metadata, the admin, the `pauser` and `upgrader` roles, the
    /// Core address, the threshold and schema version 1. There is no
    /// `initialize` (I-26).
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        e: &Env,
        admin: Address,
        pauser: Address,
        upgrader: Address,
        core: Address,
        threshold_token: Address,
        threshold: i128,
        base_uri: String,
    ) {
        storage::set_threshold(e, &threshold_token, threshold);
        storage::set_core(e, &core);
        Base::set_metadata(
            e,
            base_uri,
            String::from_str(e, NAME),
            String::from_str(e, SYMBOL),
        );
        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(e, &pauser, &Symbol::new(e, PAUSER_ROLE), &admin);
        access_control::grant_role_no_auth(e, &upgrader, &Symbol::new(e, UPGRADER_ROLE), &admin);
        upgradeable::set_schema_version(e, SCHEMA_VERSION);
        extend_instance(e);
    }

    /// Mints the article's NFT to its current Core author (I-19).
    ///
    /// Checks, in order: the article exists (Core panics with
    /// `NotRegistered`), it has no NFT (`AlreadyMinted`), and its Core total
    /// reaches the threshold (`BelowThreshold`). Blocked while paused.
    pub fn mint(e: &Env, article_id: BytesN<32>) -> u32 {
        pausable::when_not_paused(e);

        let core = CoreClient::new(e, &storage::core(e));
        let author = core.article_author(&article_id);
        author.require_auth();

        if storage::token_of_article(e, &article_id).is_some() {
            panic_with_error!(e, NftError::AlreadyMinted);
        }
        let (token, threshold) = storage::threshold(e);
        let total = core.article_total(&article_id, &token);
        if total < threshold {
            panic_with_error!(e, NftError::BelowThreshold);
        }

        let token_id = <ContractType as MintOverrides>::mint(e, &author);
        <ContractType as RoyaltySupport>::set_token_royalty(e, token_id, &author, ROYALTY_BPS);
        storage::record_mint(e, &article_id, token_id);
        storage::extend_minted_token(e, token_id, &author);

        ArticleNftMinted {
            article_id,
            author,
            token_id,
            total_at_mint: total,
        }
        .publish(e);
        token_id
    }

    /// The token minted for an article, if any.
    pub fn token_of_article(e: &Env, article_id: BytesN<32>) -> Option<u32> {
        storage::token_of_article(e, &article_id)
    }

    /// The article a token was minted for. Fails with `UnknownToken`.
    pub fn article_of_token(e: &Env, token_id: u32) -> BytesN<32> {
        storage::article_of_token(e, token_id)
            .unwrap_or_else(|| panic_with_error!(e, NftError::UnknownToken))
    }

    /// The threshold token and amount for future mints.
    pub fn threshold(e: &Env) -> (Address, i128) {
        storage::threshold(e)
    }

    /// The OpenZeppelin schema version.
    pub fn schema_version(e: &Env) -> u32 {
        upgradeable::get_schema_version(e)
    }

    /// Admin: sets the threshold for future mints. Existing NFTs are not affected.
    #[only_admin]
    pub fn set_threshold(e: &Env, token: Address, threshold: i128) {
        storage::set_threshold(e, &token, threshold);
        extend_instance(e);
        ThresholdSet { token, threshold }.publish(e);
    }

    /// `upgrader`: runs once per schema version (I-30). Fails with
    /// `AlreadyMigrated` when the stored version is not below this code's
    /// version.
    #[only_role(operator, "upgrader")]
    pub fn migrate(e: &Env, operator: Address) {
        let from_version = upgradeable::get_schema_version(e);
        if from_version >= SCHEMA_VERSION {
            panic_with_error!(e, NftError::AlreadyMigrated);
        }
        upgradeable::set_schema_version(e, SCHEMA_VERSION);
        extend_instance(e);
        NftMigrated {
            from_version,
            to_version: SCHEMA_VERSION,
        }
        .publish(e);
    }
}

#[contractimpl(contracttrait)]
impl NonFungibleToken for QuillTipArticleNft {
    type ContractType = ContractType;

    /// Owner transfer. Blocked while paused.
    fn transfer(e: &Env, from: Address, to: Address, token_id: u32) {
        pausable::when_not_paused(e);
        Self::ContractType::transfer(e, &from, &to, token_id);
        storage::extend_transferred_token(e, token_id, &from, &to);
    }

    /// Approved or operator transfer. Blocked while paused.
    fn transfer_from(e: &Env, spender: Address, from: Address, to: Address, token_id: u32) {
        pausable::when_not_paused(e);
        Self::ContractType::transfer_from(e, &spender, &from, &to, token_id);
        storage::extend_transferred_token(e, token_id, &from, &to);
    }

    fn approve(
        e: &Env,
        approver: Address,
        approved: Address,
        token_id: u32,
        live_until_ledger: u32,
    ) {
        Self::ContractType::approve(e, &approver, &approved, token_id, live_until_ledger);
        extend_instance(e);
    }

    fn approve_for_all(e: &Env, owner: Address, operator: Address, live_until_ledger: u32) {
        Self::ContractType::approve_for_all(e, &owner, &operator, live_until_ledger);
        extend_instance(e);
    }
}

/// Royalties are fixed at mint (I-20). The three OpenZeppelin setters always
/// fail; `royalty_info` keeps its OpenZeppelin default.
#[contractimpl(contracttrait)]
impl NonFungibleRoyalties for QuillTipArticleNft {
    fn set_default_royalty(e: &Env, _receiver: Address, _basis_points: u32, _operator: Address) {
        panic_with_error!(e, NftError::RoyaltyImmutable);
    }

    fn set_token_royalty(
        e: &Env,
        _token_id: u32,
        _receiver: Address,
        _basis_points: u32,
        _operator: Address,
    ) {
        panic_with_error!(e, NftError::RoyaltyImmutable);
    }

    fn remove_token_royalty(e: &Env, _token_id: u32, _operator: Address) {
        panic_with_error!(e, NftError::RoyaltyImmutable);
    }
}

/// OpenZeppelin access control. No `manager` role is used. Only an upgrader
/// can change the `upgrader` role (`quilltip_shared::roles`).
#[contractimpl(contracttrait)]
impl AccessControl for QuillTipArticleNft {
    fn grant_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        roles::grant_role(e, &account, &role, &caller);
        extend_instance(e);
    }

    fn revoke_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        roles::revoke_role(e, &account, &role, &caller);
        extend_instance(e);
    }

    fn renounce_role(e: &Env, role: Symbol, caller: Address) {
        roles::renounce_role(e, &role, &caller);
        extend_instance(e);
    }

    fn set_role_admin(e: &Env, role: Symbol, admin_role: Symbol) {
        roles::set_role_admin(e, &role, &admin_role);
        extend_instance(e);
    }

    /// Always fails (I-26): a renounce would make a pause permanent.
    fn renounce_admin(e: &Env) {
        panic_with_error!(e, NftError::AdminRenounceDisabled);
    }
}

#[contractimpl(contracttrait)]
impl Pausable for QuillTipArticleNft {
    /// `pauser` role. Blocks mints and transfers.
    #[only_role(caller, "pauser")]
    fn pause(e: &Env, caller: Address) {
        pausable::pause(e);
        extend_instance(e);
    }

    /// Admin only.
    fn unpause(e: &Env, caller: Address) {
        if access_control::get_admin(e) != Some(caller.clone()) {
            panic_with_error!(e, AccessControlError::Unauthorized);
        }
        caller.require_auth();
        pausable::unpause(e);
        extend_instance(e);
    }
}

#[contractimpl]
impl Upgradeable for QuillTipArticleNft {
    /// `upgrader` role. Stored state is kept; run `migrate` after an upgrade
    /// that raises the schema version.
    #[only_role(operator, "upgrader")]
    fn upgrade(e: &Env, new_wasm_hash: BytesN<32>, operator: Address) {
        extend_instance(e);
        upgradeable::upgrade(e, &new_wasm_hash);
    }
}
