//! `mint` (I-19): one NFT per article, only by the Core author, only at or
//! above the Core total threshold.

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation},
    Address, Error, IntoVal,
};
use stellar_contract_utils::pausable::PausableError;

use super::{article_id, assert_fails, auth_error, setup, MockCoreError, THRESHOLD};
use crate::NftError;

#[test]
fn below_threshold_fails() {
    let s = setup();
    s.set_total(&s.article, THRESHOLD - 1);
    s.allow(&s.author, "mint", (s.article.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_mint(&s.article), NftError::BelowThreshold);
    assert_eq!(s.nft.token_of_article(&s.article), None);
}

#[test]
fn zero_total_fails() {
    let s = setup();
    s.allow(&s.author, "mint", (s.article.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_mint(&s.article), NftError::BelowThreshold);
}

#[test]
fn at_threshold_mints_to_the_author() {
    let s = setup();
    s.set_total(&s.article, THRESHOLD);
    s.allow(&s.author, "mint", (s.article.clone(),).into_val(&s.e));
    let token_id = s.nft.mint(&s.article);

    // The author, and only the author, authorised exactly this call.
    assert_eq!(
        s.e.auths(),
        std::vec![(
            s.author.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    s.nft.address.clone(),
                    symbol_short!("mint"),
                    (s.article.clone(),).into_val(&s.e),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
    assert_eq!(token_id, 0);
    assert_eq!(s.nft.owner_of(&token_id), s.author);
    assert_eq!(s.nft.balance(&s.author), 1);
    assert_eq!(s.nft.token_of_article(&s.article), Some(token_id));
    assert_eq!(s.nft.article_of_token(&token_id), s.article);
}

#[test]
fn above_threshold_mints() {
    let s = setup();
    s.set_total(&s.article, THRESHOLD * 3 + 7);
    s.allow(&s.author, "mint", (s.article.clone(),).into_val(&s.e));
    assert_eq!(s.nft.mint(&s.article), 0);
}

#[test]
fn only_the_threshold_token_counts() {
    let s = setup();
    let other_token = Address::generate(&s.e);
    s.core
        .set_total(&s.article, &other_token, &(THRESHOLD * 100));
    s.allow(&s.author, "mint", (s.article.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_mint(&s.article), NftError::BelowThreshold);
}

#[test]
fn second_mint_fails() {
    let s = setup();
    let first = s.mint_default();
    s.set_total(&s.article, THRESHOLD * 10);
    s.allow(&s.author, "mint", (s.article.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_mint(&s.article), NftError::AlreadyMinted);
    assert_eq!(s.nft.token_of_article(&s.article), Some(first));
    assert_eq!(s.nft.balance(&s.author), 1);
}

#[test]
fn already_minted_is_checked_before_the_threshold() {
    let s = setup();
    s.mint_default();
    // Spec order: existence, then AlreadyMinted, then the threshold.
    s.set_total(&s.article, 0);
    s.allow(&s.author, "mint", (s.article.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_mint(&s.article), NftError::AlreadyMinted);
}

#[test]
fn unregistered_article_fails_with_core_not_registered() {
    let s = setup();
    let unknown = article_id(&s.e, 9);
    s.no_auth();
    assert_fails(
        s.nft.try_mint(&unknown),
        Error::from_contract_error(MockCoreError::NotRegistered as u32),
    );
}

#[test]
fn non_author_cannot_mint() {
    let s = setup();
    s.set_total(&s.article, THRESHOLD);
    let other = Address::generate(&s.e);
    // A different address authorises the call: the author's auth is missing.
    s.allow(&other, "mint", (s.article.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_mint(&s.article), auth_error());
    // No authorisation at all.
    s.no_auth();
    assert_fails(s.nft.try_mint(&s.article), auth_error());
    // The admin cannot mint for the author either.
    s.allow(&s.admin, "mint", (s.article.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_mint(&s.article), auth_error());
    assert_eq!(s.nft.token_of_article(&s.article), None);
}

#[test]
fn author_auth_for_another_article_does_not_count() {
    let s = setup();
    s.set_total(&s.article, THRESHOLD);
    let other_article = article_id(&s.e, 2);
    s.allow(&s.author, "mint", (other_article,).into_val(&s.e));
    assert_fails(s.nft.try_mint(&s.article), auth_error());
}

#[test]
fn after_an_author_change_the_new_author_mints() {
    let s = setup();
    s.set_total(&s.article, THRESHOLD);
    let new_author = Address::generate(&s.e);
    s.core.set_author(&s.article, &new_author);

    // The previous author can no longer mint.
    s.allow(&s.author, "mint", (s.article.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_mint(&s.article), auth_error());

    s.allow(&new_author, "mint", (s.article.clone(),).into_val(&s.e));
    let token_id = s.nft.mint(&s.article);
    assert_eq!(s.nft.owner_of(&token_id), new_author);
    let (receiver, _) = s.nft.royalty_info(&token_id, &10_000);
    assert_eq!(receiver, new_author);
}

#[test]
fn an_author_change_after_mint_changes_nothing() {
    let s = setup();
    let token_id = s.mint_default();
    let new_author = Address::generate(&s.e);
    s.core.set_author(&s.article, &new_author);
    assert_eq!(s.nft.owner_of(&token_id), s.author);
    assert_eq!(s.nft.royalty_info(&token_id, &10_000).0, s.author);
    s.allow(&new_author, "mint", (s.article.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_mint(&s.article), NftError::AlreadyMinted);
}

#[test]
fn token_ids_are_sequential_per_article() {
    let s = setup();
    let other_author = Address::generate(&s.e);
    assert_eq!(s.mint_default(), 0);
    assert_eq!(s.mint_for(&article_id(&s.e, 2), &other_author), 1);
    assert_eq!(s.mint_for(&article_id(&s.e, 3), &s.author.clone()), 2);
    assert_eq!(s.nft.balance(&s.author), 2);
    assert_eq!(s.nft.article_of_token(&1), article_id(&s.e, 2));
}

#[test]
fn paused_mint_fails() {
    let s = setup();
    s.set_total(&s.article, THRESHOLD);
    s.allow(&s.pauser, "pause", (s.pauser.clone(),).into_val(&s.e));
    s.nft.pause(&s.pauser);
    s.allow(&s.author, "mint", (s.article.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_mint(&s.article), PausableError::EnforcedPause);

    s.allow(&s.admin, "unpause", (s.admin.clone(),).into_val(&s.e));
    s.nft.unpause(&s.admin);
    s.allow(&s.author, "mint", (s.article.clone(),).into_val(&s.e));
    assert_eq!(s.nft.mint(&s.article), 0);
}

#[test]
fn a_threshold_change_applies_to_later_mints() {
    let s = setup();
    s.set_total(&s.article, THRESHOLD);
    s.allow(
        &s.admin,
        "set_threshold",
        (s.xlm.clone(), THRESHOLD + 1).into_val(&s.e),
    );
    s.nft.set_threshold(&s.xlm, &(THRESHOLD + 1));
    s.allow(&s.author, "mint", (s.article.clone(),).into_val(&s.e));
    assert_fails(s.nft.try_mint(&s.article), NftError::BelowThreshold);

    s.set_total(&s.article, THRESHOLD + 1);
    s.allow(&s.author, "mint", (s.article.clone(),).into_val(&s.e));
    assert_eq!(s.nft.mint(&s.article), 0);
}

#[test]
fn views_before_and_after_mint() {
    let s = setup();
    assert_eq!(s.nft.token_of_article(&s.article), None);
    assert_fails(s.nft.try_article_of_token(&0), NftError::UnknownToken);
    assert_eq!(s.nft.threshold(), (s.xlm.clone(), THRESHOLD));
    let token_id = s.mint_default();
    assert_eq!(s.nft.article_of_token(&token_id), s.article);
    assert_fails(s.nft.try_article_of_token(&1), NftError::UnknownToken);
}
