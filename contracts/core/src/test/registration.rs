//! Registration, content updates, splits and author change (I-7, I-8).

use soroban_sdk::{testutils::Address as _, vec, Address};

use super::*;
use crate::{CoreError, MAX_PROPOSAL_LIFETIME};

#[test]
fn register_article_stores_record() {
    let f = Fixture::new();
    let author = Address::generate(&f.e);
    let id = random_id(&f.e);
    let arweave = Some(hash(&f.e, 9));
    f.core
        .register_article(&author, &id, &hash(&f.e, 1), &arweave, &vec![&f.e]);

    let record = f.core.get_article(&id).unwrap();
    assert_eq!(record.author, author);
    assert_eq!(record.content_hash, hash(&f.e, 1));
    assert_eq!(record.arweave_id, arweave);
    assert_eq!(record.content_version, 1);
    assert_eq!(record.splits.len(), 0);
    assert_eq!(record.registered_ledger, START_LEDGER);
    assert_eq!(f.core.article_author(&id), author);
}

#[test]
fn register_article_already_registered() {
    let f = Fixture::new();
    let (id, author) = f.article();
    assert_core_err!(
        f.core
            .try_register_article(&author, &id, &hash(&f.e, 2), &None, &vec![&f.e]),
        CoreError::AlreadyRegistered
    );
}

#[test]
fn register_article_rejects_zero_hashes() {
    let f = Fixture::new();
    let a = Address::generate(&f.e);
    let e = &f.e;
    assert_core_err!(
        f.core
            .try_register_article(&a, &zero32(e), &hash(e, 1), &None, &vec![e]),
        CoreError::InvalidHash
    );
    assert_core_err!(
        f.core
            .try_register_article(&a, &random_id(e), &zero32(e), &None, &vec![e]),
        CoreError::InvalidHash
    );
    assert_core_err!(
        f.core
            .try_register_article(&a, &random_id(e), &hash(e, 1), &Some(zero32(e)), &vec![e]),
        CoreError::InvalidHash
    );
}

/// I-8: every split rule is enforced at registration.
#[test]
fn register_article_enforces_split_rules() {
    let f = Fixture::new();
    let e = &f.e;
    let r: std::vec::Vec<Address> = (0..6).map(|_| Address::generate(e)).collect();
    let try_reg = |author: &Address, s: Vec<Split>| {
        f.core
            .try_register_article(author, &random_id(e), &hash(e, 1), &None, &s)
    };

    // One entry.
    assert_core_err!(
        try_reg(&r[0], splits(e, &r[..1], &[10_000])),
        CoreError::InvalidSplits
    );
    // More than MAX_RECIPIENTS.
    assert_core_err!(
        try_reg(
            &r[0],
            splits(e, &r, &[5_000, 1_000, 1_000, 1_000, 1_000, 1_000])
        ),
        CoreError::TooManyRecipients
    );
    // First recipient is not the author.
    assert_core_err!(
        try_reg(&r[1], splits(e, &r[..2], &[5_000, 5_000])),
        CoreError::InvalidSplits
    );
    // Zero bps.
    assert_core_err!(
        try_reg(&r[0], splits(e, &r[..3], &[10_000, 0, 0])),
        CoreError::InvalidSplits
    );
    // Sum below and above 10_000.
    assert_core_err!(
        try_reg(&r[0], splits(e, &r[..2], &[5_000, 4_999])),
        CoreError::InvalidSplits
    );
    assert_core_err!(
        try_reg(&r[0], splits(e, &r[..2], &[5_000, 5_001])),
        CoreError::InvalidSplits
    );
    // Oversized bps.
    assert_core_err!(
        try_reg(&r[0], splits(e, &r[..2], &[10_001, 1])),
        CoreError::InvalidSplits
    );
    // Repeated recipient.
    let dup = std::vec![r[0].clone(), r[1].clone(), r[1].clone()];
    assert_core_err!(
        try_reg(&r[0], splits(e, &dup, &[5_000, 2_500, 2_500])),
        CoreError::InvalidSplits
    );
    // Treasury as recipient.
    let with_treasury = std::vec![r[0].clone(), f.treasury.clone()];
    assert_core_err!(
        try_reg(&r[0], splits(e, &with_treasury, &[5_000, 5_000])),
        CoreError::InvalidSplits
    );
    // Valid: 2 and 5 recipients.
    assert!(try_reg(&r[0], splits(e, &r[..2], &[9_000, 1_000])).is_ok());
    assert!(try_reg(&r[0], splits(e, &r[..5], &[2_000; 5])).is_ok());
}

#[test]
fn update_content_increments_version() {
    let f = Fixture::new();
    let (id, _) = f.article();
    f.core
        .update_content(&id, &hash(&f.e, 2), &Some(hash(&f.e, 3)));
    f.core.update_content(&id, &hash(&f.e, 4), &None);
    let record = f.core.get_article(&id).unwrap();
    assert_eq!(record.content_version, 3);
    assert_eq!(record.content_hash, hash(&f.e, 4));
    assert_eq!(record.arweave_id, None);
}

#[test]
fn update_content_errors() {
    let f = Fixture::new();
    let (id, _) = f.article();
    assert_core_err!(
        f.core
            .try_update_content(&random_id(&f.e), &hash(&f.e, 2), &None),
        CoreError::NotRegistered
    );
    assert_core_err!(
        f.core.try_update_content(&id, &zero32(&f.e), &None),
        CoreError::InvalidHash
    );
    assert_core_err!(
        f.core
            .try_update_content(&id, &hash(&f.e, 2), &Some(zero32(&f.e))),
        CoreError::InvalidHash
    );
}

/// I-8: `set_splits` enforces the rules and replaces the stored splits.
#[test]
fn set_splits_replaces_and_validates() {
    let f = Fixture::new();
    let (id, author) = f.article();
    let other = Address::generate(&f.e);
    let s = splits(&f.e, &[author.clone(), other.clone()], &[7_000, 3_000]);
    f.core.set_splits(&id, &s);
    assert_eq!(f.core.get_article(&id).unwrap().splits, s);

    assert_core_err!(
        f.core.try_set_splits(
            &id,
            &splits(&f.e, &[other.clone(), author], &[7_000, 3_000])
        ),
        CoreError::InvalidSplits
    );
    assert_core_err!(
        f.core.try_set_splits(&random_id(&f.e), &s),
        CoreError::NotRegistered
    );
    // Clearing splits is allowed.
    f.core.set_splits(&id, &vec![&f.e]);
    assert_eq!(f.core.get_article(&id).unwrap().splits.len(), 0);
}

/// I-7: the author changes in two steps before the proposal expires.
#[test]
fn author_change_two_steps() {
    let f = Fixture::new();
    let (id, old) = f.article();
    let co = Address::generate(&f.e);
    f.core.set_splits(
        &id,
        &splits(&f.e, &[old.clone(), co.clone()], &[6_000, 4_000]),
    );
    let new = Address::generate(&f.e);
    f.core.propose_author(&id, &new, &(START_LEDGER + 100));
    f.core.accept_author(&id);

    let record = f.core.get_article(&id).unwrap();
    assert_eq!(record.author, new);
    assert_eq!(record.splits.get_unchecked(0).recipient, new);
    assert_eq!(record.splits.get_unchecked(1).recipient, co);
    assert_core_err!(f.core.try_accept_author(&id), CoreError::NoPendingAuthor);
}

#[test]
fn propose_author_errors() {
    let f = Fixture::new();
    let (id, author) = f.article();
    let co = Address::generate(&f.e);
    f.core.set_splits(
        &id,
        &splits(&f.e, &[author.clone(), co.clone()], &[5_000, 5_000]),
    );
    let until = START_LEDGER + 10;

    assert_core_err!(
        f.core.try_propose_author(&random_id(&f.e), &co, &until),
        CoreError::NotRegistered
    );
    for same in [author, f.treasury.clone(), co] {
        assert_core_err!(
            f.core.try_propose_author(&id, &same, &until),
            CoreError::SameAuthor
        );
    }
    let new = Address::generate(&f.e);
    assert_core_err!(
        f.core.try_propose_author(&id, &new, &START_LEDGER),
        CoreError::InvalidExpiry
    );
    assert_core_err!(
        f.core
            .try_propose_author(&id, &new, &(START_LEDGER + MAX_PROPOSAL_LIFETIME + 1)),
        CoreError::InvalidExpiry
    );
    assert!(f
        .core
        .try_propose_author(&id, &new, &(START_LEDGER + MAX_PROPOSAL_LIFETIME))
        .is_ok());
}

/// I-7: acceptance after `live_until_ledger` fails.
#[test]
fn accept_author_after_expiry_fails() {
    let f = Fixture::new();
    let (id, author) = f.article();
    let new = Address::generate(&f.e);
    f.core.propose_author(&id, &new, &(START_LEDGER + 10));
    f.advance(10);
    // At live_until_ledger: still valid.
    let snapshot_ok = f.core.try_accept_author(&id);
    assert!(snapshot_ok.is_ok());

    let (id2, _) = f.article();
    f.core.propose_author(&id2, &new, &(START_LEDGER + 20));
    f.advance(11);
    assert_core_err!(f.core.try_accept_author(&id2), CoreError::NoPendingAuthor);
    assert_eq!(f.core.article_author(&id), new);
    let _ = author;
}

/// I-8: acceptance re-checks the split rules, since splits or the treasury
/// may change after the proposal.
#[test]
fn accept_author_rechecks_split_rules() {
    let f = Fixture::new();
    let (id, author) = f.article();
    let co = Address::generate(&f.e);
    f.core.set_splits(
        &id,
        &splits(&f.e, &[author.clone(), co.clone()], &[5_000, 5_000]),
    );
    let new = Address::generate(&f.e);
    f.core.propose_author(&id, &new, &(START_LEDGER + 10));
    // The proposed author becomes the treasury before acceptance.
    f.core.set_treasury(&new);
    assert_core_err!(f.core.try_accept_author(&id), CoreError::InvalidSplits);
}

#[test]
fn cancel_author_proposal_removes_pending() {
    let f = Fixture::new();
    let (id, _) = f.article();
    let new = Address::generate(&f.e);
    assert_core_err!(
        f.core.try_cancel_author_proposal(&id),
        CoreError::NoPendingAuthor
    );
    f.core.propose_author(&id, &new, &(START_LEDGER + 10));
    f.core.cancel_author_proposal(&id);
    assert_core_err!(f.core.try_accept_author(&id), CoreError::NoPendingAuthor);
    assert_core_err!(
        f.core.try_cancel_author_proposal(&random_id(&f.e)),
        CoreError::NotRegistered
    );
}

/// Pause blocks registration changes, but not views or cancelling a proposal.
#[test]
fn pause_blocks_registration_changes() {
    let f = Fixture::new();
    let (id, author) = f.article();
    let new = Address::generate(&f.e);
    f.core.propose_author(&id, &new, &(START_LEDGER + 10));
    f.core.pause(&f.pauser);
    let paused = Some(contract_err(ENFORCED_PAUSE));
    let e = &f.e;

    assert_eq!(
        f.core
            .try_register_article(&author, &random_id(e), &hash(e, 1), &None, &vec![e])
            .err(),
        paused
    );
    assert_eq!(
        f.core.try_update_content(&id, &hash(e, 2), &None).err(),
        paused
    );
    assert_eq!(f.core.try_set_splits(&id, &vec![e]).err(), paused);
    assert_eq!(
        f.core
            .try_propose_author(&id, &Address::generate(e), &(START_LEDGER + 5))
            .err(),
        paused
    );
    assert_eq!(f.core.try_accept_author(&id).err(), paused);
    assert_eq!(f.core.article_author(&id), author);
    f.core.cancel_author_proposal(&id);
}
