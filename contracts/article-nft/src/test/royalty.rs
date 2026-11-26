//! Royalties (I-20): 1,000 bps to the minting author, set at mint, never changed.

use soroban_sdk::{testutils::Address as _, Address, IntoVal};
use stellar_tokens::non_fungible::NonFungibleTokenError;

use super::{assert_fails, setup};
use crate::{NftError, ROYALTY_BPS};

#[test]
fn royalty_is_ten_percent_to_the_minting_author() {
    let s = setup();
    let token_id = s.mint_default();
    assert_eq!(ROYALTY_BPS, 1_000);
    for (price, expected) in [
        (0_i128, 0_i128),
        (9, 0),
        (10, 1),
        (10_000, 1_000),
        (123_456_789, 12_345_678),
        (500_000_000, 50_000_000),
    ] {
        assert_eq!(
            s.nft.royalty_info(&token_id, &price),
            (s.author.clone(), expected)
        );
    }
}

#[test]
fn royalty_receiver_stays_the_author_after_transfer() {
    let s = setup();
    let token_id = s.mint_default();
    let buyer = Address::generate(&s.e);
    s.allow(
        &s.author,
        "transfer",
        (s.author.clone(), buyer.clone(), token_id).into_val(&s.e),
    );
    s.nft.transfer(&s.author, &buyer, &token_id);
    assert_eq!(s.nft.owner_of(&token_id), buyer);
    assert_eq!(
        s.nft.royalty_info(&token_id, &10_000),
        (s.author.clone(), 1_000)
    );
}

#[test]
fn royalty_of_an_unknown_token_fails() {
    let s = setup();
    assert_fails(
        s.nft.try_royalty_info(&0, &10_000),
        NonFungibleTokenError::NonExistentToken,
    );
}

#[test]
fn set_default_royalty_always_fails() {
    let s = setup();
    let token_id = s.mint_default();
    for operator in [s.admin.clone(), s.author.clone()] {
        s.allow(
            &operator,
            "set_default_royalty",
            (operator.clone(), 5_000_u32, operator.clone()).into_val(&s.e),
        );
        assert_fails(
            s.nft.try_set_default_royalty(&operator, &5_000, &operator),
            NftError::RoyaltyImmutable,
        );
    }
    assert_eq!(
        s.nft.royalty_info(&token_id, &10_000),
        (s.author.clone(), 1_000)
    );
}

#[test]
fn set_token_royalty_always_fails() {
    let s = setup();
    let token_id = s.mint_default();
    let other = Address::generate(&s.e);
    for operator in [s.admin.clone(), s.author.clone()] {
        s.allow(
            &operator,
            "set_token_royalty",
            (token_id, other.clone(), 0_u32, operator.clone()).into_val(&s.e),
        );
        assert_fails(
            s.nft
                .try_set_token_royalty(&token_id, &other, &0, &operator),
            NftError::RoyaltyImmutable,
        );
    }
    assert_eq!(
        s.nft.royalty_info(&token_id, &10_000),
        (s.author.clone(), 1_000)
    );
}

#[test]
fn remove_token_royalty_always_fails() {
    let s = setup();
    let token_id = s.mint_default();
    s.allow(
        &s.admin,
        "remove_token_royalty",
        (token_id, s.admin.clone()).into_val(&s.e),
    );
    assert_fails(
        s.nft.try_remove_token_royalty(&token_id, &s.admin),
        NftError::RoyaltyImmutable,
    );
    s.no_auth();
    assert_fails(
        s.nft.try_remove_token_royalty(&token_id, &s.author),
        NftError::RoyaltyImmutable,
    );
    assert_eq!(
        s.nft.royalty_info(&token_id, &10_000),
        (s.author.clone(), 1_000)
    );
}
