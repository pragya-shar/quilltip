//! Tests for the Article NFT contract, mapped to the invariants in
//! `docs/architecture/v2/07-security-and-recovery.md` (I-19, I-20, I-25,
//! I-26, I-30) and the test plan in `08-testing-and-deployment.md`.
//!
//! Every `require_auth` path uses `mock_auths` with an explicit `MockAuth`
//! tree for that one invocation; no test uses `mock_all_auths`. Core is
//! replaced by [`MockCore`], which implements exactly the `CoreReader`
//! interface that the NFT calls.

mod access;
mod mint;
mod real_core;
mod royalty;
mod transfer;
mod ttl_events;
mod upgrade;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    xdr::{ScErrorCode, ScErrorType},
    Address, BytesN, Env, Error, IntoVal, String, Val, Vec,
};

use crate::{core::CoreReader, QuillTipArticleNft, QuillTipArticleNftClient};

/// 50 XLM in stroops, the testnet threshold.
pub const THRESHOLD: i128 = 500_000_000;
pub const BASE_URI: &str = "https://quilltip.test/api/nft/";

// ---------------------------------------------------------------- mock Core

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MockCoreError {
    NotRegistered = 1,
}

#[contracttype]
#[derive(Clone)]
enum MockKey {
    Author(BytesN<32>),
    Total(BytesN<32>, Address),
}

/// Stands in for Core. Test setters write the author and totals; the two
/// views follow the Core specification (section 2.2, Views).
#[contract]
pub struct MockCore;

#[contractimpl]
impl MockCore {
    pub fn set_author(e: Env, article_id: BytesN<32>, author: Address) {
        e.storage()
            .instance()
            .set(&MockKey::Author(article_id), &author);
    }

    pub fn set_total(e: Env, article_id: BytesN<32>, token: Address, total: i128) {
        e.storage()
            .instance()
            .set(&MockKey::Total(article_id, token), &total);
    }
}

#[contractimpl]
impl CoreReader for MockCore {
    fn article_author(e: Env, article_id: BytesN<32>) -> Address {
        e.storage()
            .instance()
            .get(&MockKey::Author(article_id))
            .unwrap_or_else(|| panic_with_error!(&e, MockCoreError::NotRegistered))
    }

    fn article_total(e: Env, article_id: BytesN<32>, token: Address) -> i128 {
        e.storage()
            .instance()
            .get(&MockKey::Total(article_id, token))
            .unwrap_or(0)
    }
}

// ------------------------------------------------------------------ fixture

pub struct Setup<'a> {
    pub e: Env,
    pub nft: QuillTipArticleNftClient<'a>,
    pub core: MockCoreClient<'a>,
    pub admin: Address,
    pub pauser: Address,
    pub upgrader: Address,
    pub xlm: Address,
    pub author: Address,
    pub article: BytesN<32>,
}

pub fn article_id(e: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(e, &[n; 32])
}

pub fn setup<'a>() -> Setup<'a> {
    setup_in(Env::default(), None)
}

/// Like [`setup`], with the NFT registered from optimized Wasm bytes instead of
/// natively, in an environment that writes no test snapshot.
pub fn setup_wasm<'a>(wasm: &[u8]) -> Setup<'a> {
    let e = Env::new_with_config(soroban_sdk::testutils::EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    setup_in(e, Some(wasm))
}

fn setup_in<'a>(e: Env, wasm: Option<&[u8]>) -> Setup<'a> {
    let admin = Address::generate(&e);
    let pauser = Address::generate(&e);
    let upgrader = Address::generate(&e);
    let xlm = Address::generate(&e);
    let author = Address::generate(&e);
    let core_id = e.register(MockCore, ());
    let args = (
        &admin,
        &pauser,
        &upgrader,
        &core_id,
        &xlm,
        THRESHOLD,
        String::from_str(&e, BASE_URI),
    );
    let nft_id = match wasm {
        Some(bytes) => e.register(bytes, args),
        None => e.register(QuillTipArticleNft, args),
    };
    let core = MockCoreClient::new(&e, &core_id);
    let nft = QuillTipArticleNftClient::new(&e, &nft_id);
    let article = article_id(&e, 1);
    core.set_author(&article, &author);
    Setup {
        e,
        nft,
        core,
        admin,
        pauser,
        upgrader,
        xlm,
        author,
        article,
    }
}

impl Setup<'_> {
    /// Authorises exactly one call of `fn_name(args)` on the NFT by `who`.
    pub fn allow(&self, who: &Address, fn_name: &str, args: Vec<Val>) {
        self.e.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &self.nft.address,
                fn_name,
                args,
                sub_invokes: &[],
            },
        }]);
    }

    /// Clears every mocked authorisation, so the next call has none.
    pub fn no_auth(&self) {
        self.e.mock_auths(&[]);
    }

    pub fn set_total(&self, article: &BytesN<32>, total: i128) {
        self.core.set_total(article, &self.xlm, &total);
    }

    /// Mints `article` for `author` with the total at the threshold.
    pub fn mint_for(&self, article: &BytesN<32>, author: &Address) -> u32 {
        self.core.set_author(article, author);
        self.set_total(article, THRESHOLD);
        self.allow(author, "mint", (article.clone(),).into_val(&self.e));
        self.nft.mint(article)
    }

    pub fn mint_default(&self) -> u32 {
        self.mint_for(&self.article.clone(), &self.author.clone())
    }
}

// ----------------------------------------------------------------- results

/// The error a call reports when the expected address did not authorise it.
pub fn auth_error() -> Error {
    Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
}

/// Asserts that a `try_` call failed with `expected`.
#[track_caller]
pub fn assert_fails<T: core::fmt::Debug, C: core::fmt::Debug, I: core::fmt::Debug>(
    result: Result<Result<T, C>, Result<Error, I>>,
    expected: impl Into<Error>,
) {
    match result {
        Err(Ok(error)) => assert_eq!(error, expected.into()),
        other => panic!("expected an error, got {other:?}"),
    }
}
