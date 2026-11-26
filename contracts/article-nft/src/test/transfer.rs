//! OpenZeppelin transfers and approvals, with the pause guard on transfers.

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, IntoVal,
};
use stellar_contract_utils::pausable::PausableError;
use stellar_tokens::non_fungible::NonFungibleTokenError;

use super::{assert_fails, auth_error, setup, BASE_URI};

#[test]
fn metadata_and_token_uri() {
    let s = setup();
    assert_eq!(
        s.nft.name(),
        soroban_sdk::String::from_str(&s.e, "QuillTip Article")
    );
    assert_eq!(s.nft.symbol(), soroban_sdk::String::from_str(&s.e, "QTART"));
    let token_id = s.mint_default();
    assert_eq!(
        s.nft.token_uri(&token_id),
        soroban_sdk::String::from_str(&s.e, &std::format!("{BASE_URI}{token_id}"))
    );
    assert_fails(
        s.nft.try_token_uri(&5),
        NonFungibleTokenError::NonExistentToken,
    );
}

#[test]
fn owner_transfers() {
    let s = setup();
    let token_id = s.mint_default();
    let to = Address::generate(&s.e);
    s.allow(
        &s.author,
        "transfer",
        (s.author.clone(), to.clone(), token_id).into_val(&s.e),
    );
    s.nft.transfer(&s.author, &to, &token_id);
    assert_eq!(s.nft.owner_of(&token_id), to);
    assert_eq!(s.nft.balance(&s.author), 0);
    assert_eq!(s.nft.balance(&to), 1);
}

#[test]
fn transfer_needs_the_owner_auth() {
    let s = setup();
    let token_id = s.mint_default();
    let to = Address::generate(&s.e);
    s.allow(
        &to,
        "transfer",
        (s.author.clone(), to.clone(), token_id).into_val(&s.e),
    );
    assert_fails(s.nft.try_transfer(&s.author, &to, &token_id), auth_error());
    assert_eq!(s.nft.owner_of(&token_id), s.author);
}

#[test]
fn transfer_from_a_non_owner_fails() {
    let s = setup();
    let token_id = s.mint_default();
    let other = Address::generate(&s.e);
    s.allow(
        &other,
        "transfer",
        (other.clone(), s.author.clone(), token_id).into_val(&s.e),
    );
    assert_fails(
        s.nft.try_transfer(&other, &s.author, &token_id),
        NonFungibleTokenError::IncorrectOwner,
    );
}

#[test]
fn approved_spender_transfers_once() {
    let s = setup();
    let token_id = s.mint_default();
    let spender = Address::generate(&s.e);
    let to = Address::generate(&s.e);
    let live_until = s.e.ledger().sequence() + 1_000;
    s.allow(
        &s.author,
        "approve",
        (s.author.clone(), spender.clone(), token_id, live_until).into_val(&s.e),
    );
    s.nft.approve(&s.author, &spender, &token_id, &live_until);
    assert_eq!(s.nft.get_approved(&token_id), Some(spender.clone()));

    s.allow(
        &spender,
        "transfer_from",
        (spender.clone(), s.author.clone(), to.clone(), token_id).into_val(&s.e),
    );
    s.nft.transfer_from(&spender, &s.author, &to, &token_id);
    assert_eq!(s.nft.owner_of(&token_id), to);
    // The approval is cleared by the transfer.
    assert_eq!(s.nft.get_approved(&token_id), None);

    s.allow(
        &spender,
        "transfer_from",
        (spender.clone(), to.clone(), s.author.clone(), token_id).into_val(&s.e),
    );
    assert_fails(
        s.nft.try_transfer_from(&spender, &to, &s.author, &token_id),
        NonFungibleTokenError::InsufficientApproval,
    );
}

#[test]
fn unapproved_spender_fails() {
    let s = setup();
    let token_id = s.mint_default();
    let spender = Address::generate(&s.e);
    s.allow(
        &spender,
        "transfer_from",
        (spender.clone(), s.author.clone(), spender.clone(), token_id).into_val(&s.e),
    );
    assert_fails(
        s.nft
            .try_transfer_from(&spender, &s.author, &spender, &token_id),
        NonFungibleTokenError::InsufficientApproval,
    );
}

#[test]
fn approval_expires() {
    let s = setup();
    let token_id = s.mint_default();
    let spender = Address::generate(&s.e);
    let live_until = s.e.ledger().sequence() + 10;
    s.allow(
        &s.author,
        "approve",
        (s.author.clone(), spender.clone(), token_id, live_until).into_val(&s.e),
    );
    s.nft.approve(&s.author, &spender, &token_id, &live_until);
    s.e.ledger().set_sequence_number(live_until + 1);
    assert_eq!(s.nft.get_approved(&token_id), None);
}

#[test]
fn approve_needs_the_owner_auth() {
    let s = setup();
    let token_id = s.mint_default();
    let spender = Address::generate(&s.e);
    let live_until = s.e.ledger().sequence() + 1_000;
    s.no_auth();
    assert_fails(
        s.nft
            .try_approve(&s.author, &spender, &token_id, &live_until),
        auth_error(),
    );
    s.allow(
        &spender,
        "approve",
        (spender.clone(), spender.clone(), token_id, live_until).into_val(&s.e),
    );
    assert_fails(
        s.nft
            .try_approve(&spender, &spender, &token_id, &live_until),
        NonFungibleTokenError::InvalidApprover,
    );
}

#[test]
fn operator_approved_for_all_transfers() {
    let s = setup();
    let first = s.mint_default();
    let second = s.mint_for(&super::article_id(&s.e, 2), &s.author.clone());
    let operator = Address::generate(&s.e);
    let to = Address::generate(&s.e);
    let live_until = s.e.ledger().sequence() + 1_000;
    s.allow(
        &s.author,
        "approve_for_all",
        (s.author.clone(), operator.clone(), live_until).into_val(&s.e),
    );
    s.nft.approve_for_all(&s.author, &operator, &live_until);
    assert!(s.nft.is_approved_for_all(&s.author, &operator));

    for token_id in [first, second] {
        s.allow(
            &operator,
            "transfer_from",
            (operator.clone(), s.author.clone(), to.clone(), token_id).into_val(&s.e),
        );
        s.nft.transfer_from(&operator, &s.author, &to, &token_id);
    }
    assert_eq!(s.nft.balance(&to), 2);

    // Revoking with live_until_ledger 0.
    s.allow(
        &s.author,
        "approve_for_all",
        (s.author.clone(), operator.clone(), 0_u32).into_val(&s.e),
    );
    s.nft.approve_for_all(&s.author, &operator, &0);
    assert!(!s.nft.is_approved_for_all(&s.author, &operator));
}

#[test]
fn transfers_are_blocked_while_paused_and_approvals_are_not() {
    let s = setup();
    let token_id = s.mint_default();
    let spender = Address::generate(&s.e);
    let to = Address::generate(&s.e);
    s.allow(&s.pauser, "pause", (s.pauser.clone(),).into_val(&s.e));
    s.nft.pause(&s.pauser);

    s.allow(
        &s.author,
        "transfer",
        (s.author.clone(), to.clone(), token_id).into_val(&s.e),
    );
    assert_fails(
        s.nft.try_transfer(&s.author, &to, &token_id),
        PausableError::EnforcedPause,
    );

    let live_until = s.e.ledger().sequence() + 1_000;
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
    assert_fails(
        s.nft.try_transfer_from(&spender, &s.author, &to, &token_id),
        PausableError::EnforcedPause,
    );

    // Views keep working while paused.
    assert_eq!(s.nft.owner_of(&token_id), s.author);
    assert!(s.nft.paused());

    s.allow(&s.admin, "unpause", (s.admin.clone(),).into_val(&s.e));
    s.nft.unpause(&s.admin);
    s.allow(
        &spender,
        "transfer_from",
        (spender.clone(), s.author.clone(), to.clone(), token_id).into_val(&s.e),
    );
    s.nft.transfer_from(&spender, &s.author, &to, &token_id);
    assert_eq!(s.nft.owner_of(&token_id), to);
}
