//! Direct and highlight tips (I-1 to I-6).

use soroban_sdk::{testutils::Address as _, Address};

use super::*;
use crate::{storage, CoreError, TIP_REF_TTL};

fn tip(f: &Fixture, tipper: &Address, id: &BytesN<32>, amount: i128, n: u32) {
    f.core
        .tip(tipper, id, &f.token, &amount, &None, &client_ref(&f.e, n));
}

/// I-1, I-2, I-3, I-6: a tip without splits pays net to the author and the
/// fee to the treasury, adds gross to the total, and leaves Core empty.
#[test]
fn tip_pays_author_and_treasury() {
    let f = Fixture::new();
    let (id, author) = f.article();
    let tipper = f.funded();
    tip(&f, &tipper, &id, 10_000_000, 1);

    assert_eq!(f.balance(&author), 9_750_000);
    assert_eq!(f.balance(&f.treasury), 250_000);
    assert_eq!(f.balance(&tipper), FUNDS - 10_000_000);
    assert_eq!(f.balance(&f.id()), 0);
    assert_eq!(f.core.article_total(&id, &f.token), 10_000_000);
}

/// I-1, I-2: five recipients; non-primary shares are floored and the
/// primary author receives the remainder.
#[test]
fn tip_with_five_recipients_and_highlight() {
    let f = Fixture::new();
    let (id, r) = f.article_with_splits(&[3_333, 3_333, 1_111, 1_112, 1_111]);
    let tipper = f.funded();
    let gross: i128 = 1_234_567;
    f.core.tip(
        &tipper,
        &id,
        &f.token,
        &gross,
        &Some(hash(&f.e, 7)),
        &client_ref(&f.e, 1),
    );
    let fee = gross * 250 / 10_000;
    let net = gross - fee;
    let others: std::vec::Vec<i128> = [3_333i128, 1_111, 1_112, 1_111]
        .iter()
        .map(|b| net * b / 10_000)
        .collect();
    let primary = net - others.iter().sum::<i128>();
    assert_eq!(f.balance(&f.treasury), fee);
    assert_eq!(f.balance(&r[0]), primary);
    for (i, share) in others.iter().enumerate() {
        assert_eq!(f.balance(&r[i + 1]), *share);
    }
    let paid: i128 = r.iter().map(|a| f.balance(a)).sum::<i128>() + fee;
    assert_eq!(paid, gross);
    assert_eq!(f.balance(&f.id()), 0);
}

/// I-2, edge case 7.3: `amount = min_tip = 40` with a 1% recipient. The fee
/// is 1, the 1% share is 0 and gets no transfer, the author takes the rest.
#[test]
fn zero_share_gets_no_transfer() {
    let f = Fixture::new();
    f.core.set_token(&f.token, &40, &true);
    let (id, r) = f.article_with_splits(&[9_900, 100]);
    let tipper = f.funded();
    tip(&f, &tipper, &id, 40, 1);

    // No SAC transfer event names the zero-share recipient. Read the events
    // before any other invocation replaces them.
    use soroban_sdk::testutils::Events as _;
    let transfers: std::vec::Vec<_> =
        f.e.events()
            .all()
            .filter_by_contract(&f.token)
            .events()
            .to_vec();
    assert_eq!(f.balance(&f.treasury), 1);
    assert_eq!(f.balance(&r[0]), 39);
    assert_eq!(f.balance(&r[1]), 0);
    assert_eq!(transfers.len(), 2, "author and treasury transfers only");
}

/// I-4: each tip check, with the documented precedence (the first failing
/// check decides the error).
#[test]
fn tip_checks_in_order() {
    let f = Fixture::new();
    let (id, author) = f.article();
    let tipper = f.funded();
    let unknown = f.new_token();
    let e = &f.e;
    let r = client_ref(e, 1);

    // 1 before 2: amount 0 with an unknown token.
    assert_core_err!(
        f.core.try_tip(&tipper, &id, &unknown, &0, &None, &r),
        CoreError::InvalidAmount
    );
    assert_core_err!(
        f.core.try_tip(&tipper, &id, &f.token, &-5, &None, &r),
        CoreError::InvalidAmount
    );
    // 2 before 3: unknown token with a tiny amount.
    assert_core_err!(
        f.core.try_tip(&tipper, &id, &unknown, &1, &None, &r),
        CoreError::TokenNotAllowed
    );
    // Disabled token.
    let second = f.new_token();
    f.core.set_token(&second, &MIN_TIP, &false);
    assert_core_err!(
        f.core.try_tip(&tipper, &id, &second, &MIN_TIP, &None, &r),
        CoreError::TokenNotAllowed
    );
    // 3 before 4: below minimum on an unregistered article.
    assert_core_err!(
        f.core
            .try_tip(&tipper, &random_id(e), &f.token, &(MIN_TIP - 1), &None, &r),
        CoreError::BelowMinimum
    );
    // 4 before 5: unregistered article, tipped by an author of another article.
    assert_core_err!(
        f.core
            .try_tip(&author, &random_id(e), &f.token, &MIN_TIP, &None, &r),
        CoreError::NotRegistered
    );
    // 5: self-tip.
    assert_core_err!(
        f.core.try_tip(&author, &id, &f.token, &MIN_TIP, &None, &r),
        CoreError::SelfTip
    );
    // 6: duplicate client reference.
    tip(&f, &tipper, &id, MIN_TIP, 1);
    assert_core_err!(
        f.core.try_tip(&tipper, &id, &f.token, &MIN_TIP, &None, &r),
        CoreError::DuplicateClientRef
    );
    assert_eq!(f.core.article_total(&id, &f.token), MIN_TIP);
}

/// I-4: a co-author cannot tip the article.
#[test]
fn co_author_self_tip() {
    let f = Fixture::new();
    let (id, r) = f.article_with_splits(&[5_000, 3_000, 2_000]);
    StellarAssetClient::new(&f.e, &f.token).mint(&r[2], &FUNDS);
    assert_core_err!(
        f.core
            .try_tip(&r[2], &id, &f.token, &MIN_TIP, &None, &client_ref(&f.e, 1)),
        CoreError::SelfTip
    );
}

/// I-4: pause blocks tips.
#[test]
fn pause_blocks_tips() {
    let f = Fixture::new();
    let (id, _) = f.article();
    let tipper = f.funded();
    f.core.pause(&f.pauser);
    assert_eq!(
        f.core
            .try_tip(
                &tipper,
                &id,
                &f.token,
                &MIN_TIP,
                &None,
                &client_ref(&f.e, 1)
            )
            .err(),
        Some(contract_err(ENFORCED_PAUSE))
    );
    f.core.unpause(&f.admin);
    tip(&f, &tipper, &id, MIN_TIP, 1);
}

/// I-5: a `(tipper, client_ref)` pair succeeds once within `TIP_REF_TTL`;
/// the same reference from another tipper is independent.
#[test]
fn client_ref_is_per_tipper_and_expires() {
    let f = Fixture::new();
    let (id, _) = f.article();
    let a = f.funded();
    let b = f.funded();
    tip(&f, &a, &id, MIN_TIP, 1);
    tip(&f, &b, &id, MIN_TIP, 1);
    f.advance(TIP_REF_TTL - 1);
    assert_core_err!(
        f.core
            .try_tip(&a, &id, &f.token, &MIN_TIP, &None, &client_ref(&f.e, 1)),
        CoreError::DuplicateClientRef
    );
    f.advance(2);
    tip(&f, &a, &id, MIN_TIP, 1);
    assert_eq!(f.core.article_total(&id, &f.token), 3 * MIN_TIP);
}

/// I-3: totals are per (article, token) and only grow.
#[test]
fn totals_per_article_and_token() {
    let f = Fixture::new();
    let (id1, _) = f.article();
    let (id2, _) = f.article();
    let second = f.new_token();
    f.core.set_token(&second, &MIN_TIP, &true);
    let tipper = f.funded();
    StellarAssetClient::new(&f.e, &second).mint(&tipper, &FUNDS);

    tip(&f, &tipper, &id1, 3 * MIN_TIP, 1);
    tip(&f, &tipper, &id1, 2 * MIN_TIP, 2);
    f.core.tip(
        &tipper,
        &id1,
        &second,
        &MIN_TIP,
        &None,
        &client_ref(&f.e, 3),
    );
    assert_eq!(f.core.article_total(&id1, &f.token), 5 * MIN_TIP);
    assert_eq!(f.core.article_total(&id1, &second), MIN_TIP);
    assert_eq!(f.core.article_total(&id2, &f.token), 0);
}

/// Edge case 7.3: an amount or total near `i128::MAX` fails with `Overflow`
/// and changes nothing.
#[test]
fn overflow_changes_nothing() {
    let f = Fixture::new();
    let (id, _) = f.article();
    let tipper = f.funded();
    assert_core_err!(
        f.core.try_tip(
            &tipper,
            &id,
            &f.token,
            &i128::MAX,
            &None,
            &client_ref(&f.e, 1)
        ),
        CoreError::Overflow
    );

    f.e.as_contract(&f.id(), || {
        storage::set_total(&f.e, &id, &f.token, i128::MAX - 10);
    });
    assert_core_err!(
        f.core.try_tip(
            &tipper,
            &id,
            &f.token,
            &MIN_TIP,
            &None,
            &client_ref(&f.e, 2)
        ),
        CoreError::Overflow
    );
    assert_eq!(f.core.article_total(&id, &f.token), i128::MAX - 10);
    assert_eq!(f.balance(&tipper), FUNDS);
}

/// After an author change, tips pay the new author and keep the total (I-3, I-7).
#[test]
fn tips_follow_author_change() {
    let f = Fixture::new();
    let (id, old) = f.article();
    let tipper = f.funded();
    tip(&f, &tipper, &id, MIN_TIP, 1);
    let new = Address::generate(&f.e);
    f.core.propose_author(&id, &new, &(START_LEDGER + 10));
    f.core.accept_author(&id);
    tip(&f, &tipper, &id, MIN_TIP, 2);
    assert_eq!(f.balance(&old), MIN_TIP * 9_750 / 10_000);
    assert_eq!(f.balance(&new), MIN_TIP * 9_750 / 10_000);
    assert_eq!(f.core.article_total(&id, &f.token), 2 * MIN_TIP);
    // The old author may now tip the article.
    StellarAssetClient::new(&f.e, &f.token).mint(&old, &FUNDS);
    tip(&f, &old, &id, MIN_TIP, 3);
}

/// Treasury changes apply to later tips.
#[test]
fn tips_pay_new_treasury() {
    let f = Fixture::new();
    let (id, _) = f.article();
    let tipper = f.funded();
    let new_treasury = Address::generate(&f.e);
    f.core.set_treasury(&new_treasury);
    tip(&f, &tipper, &id, MIN_TIP, 1);
    assert_eq!(f.balance(&new_treasury), MIN_TIP / 40);
    assert_eq!(f.balance(&f.treasury), 0);
}
