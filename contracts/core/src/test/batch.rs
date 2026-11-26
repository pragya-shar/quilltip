//! `tip_batch` (I-9, plus I-1 to I-5 per item).

use soroban_sdk::{testutils::Events as _, Address};

use super::*;
use crate::{CoreError, TipInput, MAX_BATCH_ITEMS};

pub fn item(f: &Fixture, id: &BytesN<32>, amount: i128, n: u32) -> TipInput {
    TipInput {
        article_id: id.clone(),
        amount,
        highlight_id: Some(hash(&f.e, n as u8)),
        client_ref: client_ref(&f.e, n),
    }
}

pub fn items(f: &Fixture, list: &[TipInput]) -> Vec<TipInput> {
    let mut v = Vec::new(&f.e);
    for i in list {
        v.push_back(i.clone());
    }
    v
}

/// I-9: one `Tipped` per item; every item pays and counts as a single tip would.
#[test]
fn batch_pays_every_item() {
    let f = Fixture::new();
    let (a, author_a) = f.article();
    let (b, r) = f.article_with_splits(&[5_000, 5_000]);
    let tipper = f.funded();
    f.core.tip_batch(
        &tipper,
        &f.token,
        &items(
            &f,
            &[
                item(&f, &a, MIN_TIP, 1),
                item(&f, &b, 2 * MIN_TIP, 2),
                item(&f, &a, 3 * MIN_TIP, 3),
            ],
        ),
    );
    let tipped = f.e.events().all().filter_by_contract(&f.id());
    assert_eq!(tipped.events().len(), 3);
    assert_eq!(f.core.article_total(&a, &f.token), 4 * MIN_TIP);
    assert_eq!(f.core.article_total(&b, &f.token), 2 * MIN_TIP);
    assert_eq!(f.balance(&author_a), 4 * MIN_TIP * 9_750 / 10_000);
    assert_eq!(
        f.balance(&r[0]) + f.balance(&r[1]),
        2 * MIN_TIP * 9_750 / 10_000
    );
    assert_eq!(f.balance(&f.treasury), 6 * MIN_TIP / 40);
    assert_eq!(f.balance(&f.id()), 0);
}

#[test]
fn batch_empty_and_too_many_items() {
    let f = Fixture::new();
    let (a, _) = f.article();
    let tipper = f.funded();
    assert_core_err!(
        f.core.try_tip_batch(&tipper, &f.token, &Vec::new(&f.e)),
        CoreError::BatchEmpty
    );
    let list: std::vec::Vec<TipInput> = (0..MAX_BATCH_ITEMS + 1)
        .map(|n| item(&f, &a, MIN_TIP, n))
        .collect();
    assert_core_err!(
        f.core.try_tip_batch(&tipper, &f.token, &items(&f, &list)),
        CoreError::BatchTooLarge
    );
    // Exactly MAX_BATCH_ITEMS without splits: 20 transfers, accepted.
    assert!(f
        .core
        .try_tip_batch(&tipper, &f.token, &items(&f, &list[..10]))
        .is_ok());
}

/// I-9: Σ (recipients + 1) above 24 fails; exactly 24 is accepted.
#[test]
fn batch_transfer_cap() {
    let f = Fixture::new();
    let (five, _) = f.article_with_splits(&[2_000; 5]);
    let (plain, _) = f.article();
    let tipper = f.funded();
    // 4 × 6 = 24 transfers.
    let at_cap: std::vec::Vec<TipInput> = (0..4).map(|n| item(&f, &five, MIN_TIP, n)).collect();
    assert!(f
        .core
        .try_tip_batch(&tipper, &f.token, &items(&f, &at_cap))
        .is_ok());
    // 24 + 2 = 26 transfers.
    let mut over: std::vec::Vec<TipInput> = (10..14).map(|n| item(&f, &five, MIN_TIP, n)).collect();
    over.push(item(&f, &plain, MIN_TIP, 20));
    assert_core_err!(
        f.core.try_tip_batch(&tipper, &f.token, &items(&f, &over)),
        CoreError::BatchTooLarge
    );
}

#[test]
fn batch_duplicate_client_ref() {
    let f = Fixture::new();
    let (a, _) = f.article();
    let tipper = f.funded();
    let dup = [item(&f, &a, MIN_TIP, 1), item(&f, &a, 2 * MIN_TIP, 1)];
    assert_core_err!(
        f.core.try_tip_batch(&tipper, &f.token, &items(&f, &dup)),
        CoreError::DuplicateClientRef
    );
    // A reference used by an earlier single tip also fails inside a batch (I-5).
    f.core
        .tip(&tipper, &a, &f.token, &MIN_TIP, &None, &client_ref(&f.e, 7));
    let reused = [item(&f, &a, MIN_TIP, 8), item(&f, &a, MIN_TIP, 7)];
    assert_core_err!(
        f.core.try_tip_batch(&tipper, &f.token, &items(&f, &reused)),
        CoreError::DuplicateClientRef
    );
}

/// I-9: the batch is atomic; a failing item reverts every earlier item.
#[test]
fn batch_is_atomic() {
    let f = Fixture::new();
    let (a, author) = f.article();
    let tipper = f.funded();
    let list = [
        item(&f, &a, MIN_TIP, 1),
        item(&f, &a, MIN_TIP, 2),
        item(&f, &random_id(&f.e), MIN_TIP, 3),
    ];
    assert_core_err!(
        f.core.try_tip_batch(&tipper, &f.token, &items(&f, &list)),
        CoreError::NotRegistered
    );
    assert_eq!(f.core.article_total(&a, &f.token), 0);
    assert_eq!(f.balance(&author), 0);
    assert_eq!(f.balance(&tipper), FUNDS);
    // The references of the reverted items are still free.
    f.core.tip_batch(&tipper, &f.token, &items(&f, &list[..2]));
}

/// I-4 per item: each tip check applies inside a batch.
#[test]
fn batch_item_checks() {
    let f = Fixture::new();
    let (a, author) = f.article();
    let tipper = f.funded();
    let cases: [(TipInput, CoreError); 3] = [
        (item(&f, &a, 0, 1), CoreError::InvalidAmount),
        (item(&f, &a, MIN_TIP - 1, 2), CoreError::BelowMinimum),
        (
            item(&f, &random_id(&f.e), MIN_TIP, 3),
            CoreError::NotRegistered,
        ),
    ];
    for (bad, err) in cases {
        let list = [item(&f, &a, MIN_TIP, 9), bad];
        assert_core_err!(
            f.core.try_tip_batch(&tipper, &f.token, &items(&f, &list)),
            err
        );
    }
    StellarAssetClient::new(&f.e, &f.token).mint(&author, &FUNDS);
    assert_core_err!(
        f.core
            .try_tip_batch(&author, &f.token, &items(&f, &[item(&f, &a, MIN_TIP, 1)])),
        CoreError::SelfTip
    );
    let unknown = f.new_token();
    assert_core_err!(
        f.core
            .try_tip_batch(&tipper, &unknown, &items(&f, &[item(&f, &a, MIN_TIP, 1)])),
        CoreError::TokenNotAllowed
    );
    f.core.pause(&f.pauser);
    assert_eq!(
        f.core
            .try_tip_batch(&tipper, &f.token, &items(&f, &[item(&f, &a, MIN_TIP, 1)]))
            .err(),
        Some(contract_err(ENFORCED_PAUSE))
    );
    let _: Address = author;
}
