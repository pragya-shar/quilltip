//! Core tests (`08-testing-and-deployment.md`, section 8.1).
//!
//! Every test names the invariants it covers (`07-security-and-recovery.md`,
//! section 7.1) in its name or doc comment.

extern crate std;

/// Asserts a `try_` result failed with the given `CoreError`.
macro_rules! assert_core_err {
    ($result:expr, $err:expr) => {
        assert_eq!($result.err(), Some($crate::test::core_err($err)))
    };
}

mod admin;
mod auth;
mod batch;
mod events;
mod property;
mod registration;
mod resources;
mod tipping;
mod ttl;
mod upgrade;

use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig, Ledger, LedgerInfo},
    token::{StellarAssetClient, TokenClient},
    vec, Address, BytesN, Env, Error, InvokeError, Vec,
};

use crate::{CoreError, QuillTipCore, QuillTipCoreClient, Split};

/// Testnet minimum persistent TTL (7 days).
pub const TESTNET_MIN_PERSISTENT_TTL: u32 = 120_960;
/// Testnet minimum temporary TTL.
pub const TESTNET_MIN_TEMP_TTL: u32 = 16;
pub const START_LEDGER: u32 = 1_000_000;
pub const MIN_TIP: i128 = 1_000_000;
pub const FUNDS: i128 = 1_000_000_000_000_000;

pub struct Fixture {
    pub e: Env,
    pub core: QuillTipCoreClient<'static>,
    pub admin: Address,
    pub pauser: Address,
    pub upgrader: Address,
    pub treasury: Address,
    pub token: Address,
    pub issuer: Address,
}

/// Testnet-like ledger settings at `sequence`, on the host's protocol version.
pub fn ledger_info(e: &Env, sequence: u32) -> LedgerInfo {
    LedgerInfo {
        timestamp: 1_800_000_000 + u64::from(sequence) * 5,
        protocol_version: e.ledger().get().protocol_version,
        sequence_number: sequence,
        network_id: [7; 32],
        base_reserve: 10,
        min_temp_entry_ttl: TESTNET_MIN_TEMP_TTL,
        min_persistent_entry_ttl: TESTNET_MIN_PERSISTENT_TTL,
        max_entry_ttl: 180 * quilltip_shared::DAY,
    }
}

impl Fixture {
    /// Deploys Core with `mock_all_auths`. Auth-specific tests switch to
    /// explicit `mock_auths` per invocation.
    pub fn new() -> Self {
        Self::deploy(None)
    }

    /// Native deployment without a test snapshot, for property tests whose
    /// inputs are random.
    pub fn without_snapshot() -> Self {
        Self::build(None, false)
    }

    /// Deploys Core natively (`None`) or from Wasm bytes.
    ///
    /// Wasm-mode tests write no snapshot: the snapshot embeds the code hash,
    /// which changes with every build.
    pub fn deploy(code: Option<&[u8]>) -> Self {
        Self::build(code, code.is_none())
    }

    fn build(code: Option<&[u8]>, snapshot: bool) -> Self {
        let e = Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: snapshot,
        });
        e.ledger().set(ledger_info(&e, START_LEDGER));
        e.mock_all_auths();

        let admin = Address::generate(&e);
        let pauser = Address::generate(&e);
        let upgrader = Address::generate(&e);
        let treasury = Address::generate(&e);
        let issuer = Address::generate(&e);
        let token = e
            .register_stellar_asset_contract_v2(issuer.clone())
            .address();

        let args = (&admin, &pauser, &upgrader, &treasury, &token, MIN_TIP);
        let id = match code {
            None => e.register(QuillTipCore, args),
            Some(wasm) => e.register(wasm, args),
        };
        let core = QuillTipCoreClient::new(&e, &id);
        Fixture {
            e,
            core,
            admin,
            pauser,
            upgrader,
            treasury,
            token,
            issuer,
        }
    }

    pub fn id(&self) -> Address {
        self.core.address.clone()
    }

    pub fn token_client(&self) -> TokenClient<'static> {
        TokenClient::new(&self.e, &self.token)
    }

    pub fn balance(&self, who: &Address) -> i128 {
        self.token_client().balance(who)
    }

    /// A funded account.
    pub fn funded(&self) -> Address {
        let who = Address::generate(&self.e);
        StellarAssetClient::new(&self.e, &self.token).mint(&who, &FUNDS);
        who
    }

    pub fn new_token(&self) -> Address {
        self.e
            .register_stellar_asset_contract_v2(self.issuer.clone())
            .address()
    }

    pub fn advance(&self, ledgers: u32) {
        let seq = self.e.ledger().sequence();
        self.e.ledger().set(ledger_info(&self.e, seq + ledgers));
    }

    /// Registers an article with no splits and returns `(article_id, author)`.
    pub fn article(&self) -> (BytesN<32>, Address) {
        let author = Address::generate(&self.e);
        let id = random_id(&self.e);
        self.core
            .register_article(&author, &id, &hash(&self.e, 1), &None, &vec![&self.e]);
        (id, author)
    }

    /// Registers an article with the given co-author bps (first is the author).
    pub fn article_with_splits(&self, bps: &[u32]) -> (BytesN<32>, std::vec::Vec<Address>) {
        let recipients: std::vec::Vec<Address> =
            bps.iter().map(|_| Address::generate(&self.e)).collect();
        let id = random_id(&self.e);
        self.core.register_article(
            &recipients[0],
            &id,
            &hash(&self.e, 1),
            &None,
            &splits(&self.e, &recipients, bps),
        );
        (id, recipients)
    }
}

pub fn splits(e: &Env, recipients: &[Address], bps: &[u32]) -> Vec<Split> {
    let mut out = Vec::new(e);
    for (r, b) in recipients.iter().zip(bps) {
        out.push_back(Split {
            recipient: r.clone(),
            bps: *b,
        });
    }
    out
}

pub fn hash(e: &Env, n: u8) -> BytesN<32> {
    let mut b = [n; 32];
    b[0] = 0xAB;
    BytesN::from_array(e, &b)
}

pub fn zero32(e: &Env) -> BytesN<32> {
    BytesN::from_array(e, &[0; 32])
}

/// A fresh, non-zero 32-byte ID. Deterministic per test (derived from the
/// Env's address generator), so committed snapshots are stable.
pub fn random_id(e: &Env) -> BytesN<32> {
    use soroban_sdk::xdr::ToXdr;
    e.crypto()
        .sha256(&Address::generate(e).to_xdr(e))
        .to_bytes()
}

pub fn client_ref(e: &Env, n: u32) -> BytesN<16> {
    let mut b = [0u8; 16];
    b[..4].copy_from_slice(&n.to_be_bytes());
    b[15] = 1;
    BytesN::from_array(e, &b)
}

/// The error a `try_` call returns for a contract error code.
pub fn contract_err(code: u32) -> Result<Error, InvokeError> {
    Ok(Error::from_contract_error(code))
}

pub fn core_err(err: CoreError) -> Result<Error, InvokeError> {
    contract_err(err as u32)
}

/// Reads a Wasm file from `QUILLTIP_WASM_DIR` (set by CI after the
/// reproducible build). Tests that need it are `#[ignore]` by default.
pub fn wasm_file(name: &str) -> std::vec::Vec<u8> {
    let dir = std::env::var("QUILLTIP_WASM_DIR").expect(
        "set QUILLTIP_WASM_DIR to a directory with the built Wasm (see contracts/core/README.md)",
    );
    let path = std::path::Path::new(&dir).join(name);
    std::fs::read(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()))
}

/// OpenZeppelin `PausableError::EnforcedPause`.
pub const ENFORCED_PAUSE: u32 = 1000;
/// OpenZeppelin `AccessControlError::Unauthorized`.
pub const UNAUTHORIZED: u32 = 2000;
