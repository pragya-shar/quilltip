//! The NFT against the real Core contract (`quilltip-core`), not the mock.
//! Core and token setup use `mock_all_auths`; every NFT call under test
//! authorises exactly one invocation with `mock_auths`.

use quilltip_core::{QuillTipCore, QuillTipCoreClient};
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
    vec, Address, BytesN, Env, IntoVal, String,
};

use super::{article_id, assert_fails, auth_error, BASE_URI, THRESHOLD};
use crate::{NftError, QuillTipArticleNft, QuillTipArticleNftClient};

const MIN_TIP: i128 = 1_000_000;

struct RealCore<'a> {
    e: Env,
    core: QuillTipCoreClient<'a>,
    nft: QuillTipArticleNftClient<'a>,
    token: Address,
    author: Address,
    tipper: Address,
    article: BytesN<32>,
}

fn setup<'a>() -> RealCore<'a> {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let pauser = Address::generate(&e);
    let upgrader = Address::generate(&e);
    let treasury = Address::generate(&e);
    let issuer = Address::generate(&e);
    let token = e.register_stellar_asset_contract_v2(issuer).address();
    let core_id = e.register(
        QuillTipCore,
        (&admin, &pauser, &upgrader, &treasury, &token, MIN_TIP),
    );
    let nft_id = e.register(
        QuillTipArticleNft,
        (
            &admin,
            &pauser,
            &upgrader,
            &core_id,
            &token,
            THRESHOLD,
            String::from_str(&e, BASE_URI),
        ),
    );
    let core = QuillTipCoreClient::new(&e, &core_id);
    let nft = QuillTipArticleNftClient::new(&e, &nft_id);

    let author = Address::generate(&e);
    let tipper = Address::generate(&e);
    StellarAssetClient::new(&e, &token).mint(&tipper, &(10 * THRESHOLD));
    let article = core.register_article(
        &author,
        &article_id(&e, 7),
        &BytesN::from_array(&e, &[0xAB; 32]),
        &None,
        &vec![&e],
    );
    RealCore {
        e,
        core,
        nft,
        token,
        author,
        tipper,
        article,
    }
}

impl RealCore<'_> {
    fn tip(&self, amount: i128, n: u8) {
        self.e.mock_all_auths();
        let mut client_ref = [0u8; 16];
        client_ref[15] = n;
        self.core.tip(
            &self.tipper,
            &self.article,
            &self.token,
            &amount,
            &None,
            &BytesN::from_array(&self.e, &client_ref),
        );
    }

    fn allow_mint(&self, who: &Address, article: &BytesN<32>) {
        self.e.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &self.nft.address,
                fn_name: "mint",
                args: (article.clone(),).into_val(&self.e),
                sub_invokes: &[],
            },
        }]);
    }
}

#[test]
fn mint_uses_the_real_core_author_and_total() {
    let s = setup();
    s.tip(THRESHOLD - MIN_TIP, 1);
    assert_eq!(
        s.core.article_total(&s.article, &s.token),
        THRESHOLD - MIN_TIP
    );
    s.allow_mint(&s.author, &s.article);
    assert_fails(s.nft.try_mint(&s.article), NftError::BelowThreshold);

    s.tip(MIN_TIP, 2);
    s.allow_mint(&s.author, &s.article);
    let token_id = s.nft.mint(&s.article);
    assert_eq!(s.nft.owner_of(&token_id), s.author);
    assert_eq!(s.nft.token_of_article(&s.article), Some(token_id));
    assert_eq!(
        s.nft.royalty_info(&token_id, &1_000),
        (s.author.clone(), 100)
    );

    s.allow_mint(&s.author, &s.article);
    assert_fails(s.nft.try_mint(&s.article), NftError::AlreadyMinted);
}

#[test]
fn only_the_real_core_author_can_mint() {
    let s = setup();
    s.tip(THRESHOLD, 1);
    s.allow_mint(&s.tipper, &s.article);
    assert_fails(s.nft.try_mint(&s.article), auth_error());
}

#[test]
fn an_unregistered_article_fails_with_the_core_error() {
    let s = setup();
    let unknown = article_id(&s.e, 9);
    s.allow_mint(&s.author, &unknown);
    assert_fails(
        s.nft.try_mint(&unknown),
        soroban_sdk::Error::from_contract_error(quilltip_core::CoreError::NotRegistered as u32),
    );
}
