//! TTL policy (I-25), events, error codes and the `mint` resource figures.

use quilltip_shared::{errors::NFT, DAY, TTL_EXTEND_TO, TTL_THRESHOLD};
use soroban_sdk::{
    testutils::{
        storage::{Instance, Persistent},
        Address as _, Events, Ledger,
    },
    Address, Event, IntoVal,
};
use stellar_contract_utils::pausable::{Paused, Unpaused};
use stellar_tokens::non_fungible::{royalties::SetTokenRoyalty, Mint, NFTStorageKey, Transfer};

use super::{setup, setup_wasm, Setup, THRESHOLD};
use crate::{
    storage::{DataKey, NFTRoyaltiesStorageKey},
    ArticleNftMinted, NftError, NftMigrated, ThresholdSet, ROYALTY_BPS, SCHEMA_VERSION,
};

fn persistent_ttl<K: soroban_sdk::IntoVal<soroban_sdk::Env, soroban_sdk::Val>>(
    s: &Setup,
    key: &K,
) -> u32 {
    s.e.as_contract(&s.nft.address, || s.e.storage().persistent().get_ttl(key))
}

fn instance_ttl(s: &Setup) -> u32 {
    s.e.as_contract(&s.nft.address, || s.e.storage().instance().get_ttl())
}

#[test]
fn mint_extends_every_entry_it_writes() {
    let s = setup();
    let token_id = s.mint_default();
    assert!(instance_ttl(&s) >= TTL_THRESHOLD);
    for ttl in [
        persistent_ttl(&s, &DataKey::MintedArticle(s.article.clone())),
        persistent_ttl(&s, &DataKey::TokenArticle(token_id)),
        persistent_ttl(&s, &NFTStorageKey::Owner(token_id)),
        persistent_ttl(&s, &NFTStorageKey::Balance(s.author.clone())),
        persistent_ttl(&s, &NFTRoyaltiesStorageKey::TokenRoyalty(token_id)),
    ] {
        assert_eq!(ttl, TTL_EXTEND_TO);
    }
}

#[test]
fn entries_outlive_the_testnet_minimum_and_are_renewed() {
    let s = setup();
    let token_id = s.mint_default();
    // Past the 7-day testnet minimum persistent TTL.
    let start = s.e.ledger().sequence();
    s.e.ledger().set_sequence_number(start + 8 * DAY);
    assert_eq!(s.nft.owner_of(&token_id), s.author);
    assert_eq!(s.nft.token_of_article(&s.article), Some(token_id));
    assert_eq!(s.nft.royalty_info(&token_id, &100).1, 10);

    // 100 days later the remaining TTL is below the threshold; a transfer
    // renews every entry it writes and the instance.
    s.e.ledger().set_sequence_number(start + 100 * DAY);
    let to = Address::generate(&s.e);
    s.allow(
        &s.author,
        "transfer",
        (s.author.clone(), to.clone(), token_id).into_val(&s.e),
    );
    s.nft.transfer(&s.author, &to, &token_id);
    assert!(instance_ttl(&s) >= TTL_THRESHOLD);
    for key in [
        NFTStorageKey::Owner(token_id),
        NFTStorageKey::Balance(s.author.clone()),
        NFTStorageKey::Balance(to.clone()),
    ] {
        assert!(persistent_ttl(&s, &key) >= TTL_THRESHOLD);
    }
}

#[test]
fn transfer_from_renews_the_entries_it_writes() {
    let s = setup();
    let token_id = s.mint_default();
    let start = s.e.ledger().sequence();
    s.e.ledger().set_sequence_number(start + 100 * DAY);
    let spender = Address::generate(&s.e);
    let to = Address::generate(&s.e);
    let live_until = s.e.ledger().sequence() + 100;
    s.allow(
        &s.author,
        "approve",
        (s.author.clone(), spender.clone(), token_id, live_until).into_val(&s.e),
    );
    s.nft.approve(&s.author, &spender, &token_id, &live_until);
    s.allow(
        &spender,
        "transfer_from",
        (spender.clone(), s.author.clone(), to.clone(), token_id).into_val(&s.e),
    );
    s.nft.transfer_from(&spender, &s.author, &to, &token_id);
    assert_eq!(s.nft.owner_of(&token_id), to);
    for key in [
        NFTStorageKey::Owner(token_id),
        NFTStorageKey::Balance(s.author.clone()),
        NFTStorageKey::Balance(to.clone()),
    ] {
        assert_eq!(persistent_ttl(&s, &key), TTL_EXTEND_TO);
    }
}

#[test]
fn approvals_extend_the_instance() {
    let s = setup();
    let token_id = s.mint_default();
    let start = s.e.ledger().sequence();

    s.e.ledger().set_sequence_number(start + 100 * DAY);
    let spender = Address::generate(&s.e);
    let live_until = s.e.ledger().sequence() + 100;
    s.allow(
        &s.author,
        "approve",
        (s.author.clone(), spender.clone(), token_id, live_until).into_val(&s.e),
    );
    s.nft.approve(&s.author, &spender, &token_id, &live_until);
    assert_eq!(instance_ttl(&s), TTL_EXTEND_TO);

    s.e.ledger().set_sequence_number(start + 200 * DAY);
    let operator = Address::generate(&s.e);
    let live_until = s.e.ledger().sequence() + 100;
    s.allow(
        &s.author,
        "approve_for_all",
        (s.author.clone(), operator.clone(), live_until).into_val(&s.e),
    );
    s.nft.approve_for_all(&s.author, &operator, &live_until);
    assert_eq!(instance_ttl(&s), TTL_EXTEND_TO);
}

#[test]
fn admin_calls_extend_the_instance() {
    let s = setup();
    let start = s.e.ledger().sequence();
    s.e.ledger().set_sequence_number(start + 100 * DAY);
    s.allow(
        &s.admin,
        "set_threshold",
        (s.xlm.clone(), THRESHOLD).into_val(&s.e),
    );
    s.nft.set_threshold(&s.xlm, &THRESHOLD);
    assert_eq!(instance_ttl(&s), TTL_EXTEND_TO);
}

#[test]
fn mint_events() {
    let s = setup();
    s.set_total(&s.article, THRESHOLD + 5);
    s.allow(&s.author, "mint", (s.article.clone(),).into_val(&s.e));
    let token_id = s.nft.mint(&s.article);
    let id = &s.nft.address;
    assert_eq!(
        s.e.events().all().filter_by_contract(id),
        [
            Mint {
                to: s.author.clone(),
                token_id,
            }
            .to_xdr(&s.e, id),
            SetTokenRoyalty {
                receiver: s.author.clone(),
                token_id,
                basis_points: ROYALTY_BPS,
            }
            .to_xdr(&s.e, id),
            ArticleNftMinted {
                article_id: s.article.clone(),
                author: s.author.clone(),
                token_id,
                total_at_mint: THRESHOLD + 5,
            }
            .to_xdr(&s.e, id),
        ]
    );
}

#[test]
fn transfer_event() {
    let s = setup();
    let token_id = s.mint_default();
    let to = Address::generate(&s.e);
    s.allow(
        &s.author,
        "transfer",
        (s.author.clone(), to.clone(), token_id).into_val(&s.e),
    );
    s.nft.transfer(&s.author, &to, &token_id);
    let id = &s.nft.address;
    assert_eq!(
        s.e.events().all().filter_by_contract(id),
        [Transfer {
            from: s.author.clone(),
            to,
            token_id,
        }
        .to_xdr(&s.e, id)]
    );
}

#[test]
fn admin_events() {
    let s = setup();
    let id = &s.nft.address;
    s.allow(
        &s.admin,
        "set_threshold",
        (s.xlm.clone(), 9_i128).into_val(&s.e),
    );
    s.nft.set_threshold(&s.xlm, &9);
    assert_eq!(
        s.e.events().all().filter_by_contract(id),
        [ThresholdSet {
            token: s.xlm.clone(),
            threshold: 9,
        }
        .to_xdr(&s.e, id)]
    );

    s.allow(&s.pauser, "pause", (s.pauser.clone(),).into_val(&s.e));
    s.nft.pause(&s.pauser);
    assert_eq!(
        s.e.events().all().filter_by_contract(id),
        [Paused {}.to_xdr(&s.e, id)]
    );
    s.allow(&s.admin, "unpause", (s.admin.clone(),).into_val(&s.e));
    s.nft.unpause(&s.admin);
    assert_eq!(
        s.e.events().all().filter_by_contract(id),
        [Unpaused {}.to_xdr(&s.e, id)]
    );

    s.e.as_contract(id, || {
        stellar_contract_utils::upgradeable::set_schema_version(&s.e, 0)
    });
    s.allow(&s.upgrader, "migrate", (s.upgrader.clone(),).into_val(&s.e));
    s.nft.migrate(&s.upgrader);
    assert_eq!(
        s.e.events().all().filter_by_contract(id),
        [NftMigrated {
            from_version: 0,
            to_version: SCHEMA_VERSION,
        }
        .to_xdr(&s.e, id)]
    );
}

#[test]
fn error_codes_match_the_specification() {
    let codes = [
        (NftError::BelowThreshold, 70),
        (NftError::AlreadyMinted, 71),
        (NftError::InvalidThreshold, 72),
        (NftError::AlreadyMigrated, 73),
        (NftError::UnknownToken, 74),
        (NftError::RoyaltyImmutable, 75),
        (NftError::AdminRenounceDisabled, 76),
    ];
    for (error, code) in codes {
        assert_eq!(error as u32, code);
        assert!(NFT.contains(code));
    }
}

/// `mint` under the SDK's default mainnet resource limits, which the test
/// environment enforces. Native registration leaves out Wasm VM costs; see
/// `mint_resources_on_wasm` for the figures on the optimized Wasm.
#[test]
fn mint_resources() {
    measure_mint(&setup(), "native");
}

/// The same measurement on the optimized Wasm. Run after the reproducible
/// build:
/// `QUILLTIP_NFT_WASM=<out>/quilltip_article_nft.wasm cargo test -p
/// quilltip-article-nft mint_resources_on_wasm -- --ignored --nocapture`.
#[test]
#[ignore = "needs QUILLTIP_NFT_WASM, the optimized Wasm from the reproducible build"]
fn mint_resources_on_wasm() {
    let path = std::env::var("QUILLTIP_NFT_WASM").expect("QUILLTIP_NFT_WASM");
    let wasm = std::fs::read(path).expect("read the Wasm");
    measure_mint(&setup_wasm(&wasm), "wasm");
}

fn measure_mint(s: &Setup, label: &str) {
    s.set_total(&s.article, THRESHOLD);
    s.allow(&s.author, "mint", (s.article.clone(),).into_val(&s.e));
    let token_id = s.nft.mint(&s.article);
    let r = s.e.cost_estimate().resources();
    assert_eq!(s.nft.owner_of(&token_id), s.author);
    std::println!(
        "mint ({label}): instructions={} mem_bytes={} disk_read_entries={} memory_read_entries={} write_entries={} write_bytes={} contract_events_size_bytes={}",
        r.instructions,
        r.mem_bytes,
        r.disk_read_entries,
        r.memory_read_entries,
        r.write_entries,
        r.write_bytes,
        r.contract_events_size_bytes,
    );
    // Writes: owner, balance, royalty, MintedArticle, TokenArticle, the
    // instance (token counter) and the author's authorisation nonce.
    assert_eq!(r.write_entries, 7);
    assert!(r.contract_events_size_bytes < 1_000);
}
