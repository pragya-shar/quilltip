//! Tab contract tests. Each test names the invariants it covers (`I-n`,
//! `docs/architecture/v2/07-security-and-recovery.md`, section 7.1).
//!
//! Authorisation uses `mock_auths` with an explicit tree per invocation, never
//! `mock_all_auths`.
extern crate std;

use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::testutils::{
    Address as _, EnvTestConfig, Events as _, Ledger, MockAuth, MockAuthInvoke,
};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Address, BytesN, Env, IntoVal, Val, Vec};

use quilltip_shared::payload::{AcceptancePayload, VoucherPayload};

use crate::{QuillTipTab, QuillTipTabClient, Voucher};

mod admin;
mod edge;
mod props;
mod reader;
mod resource;
mod roles;
mod settle;
mod upgrade;
mod vectors;

/// Testnet passphrase hash, used as the ledger network ID in tests.
pub const TESTNET_NETWORK_ID: [u8; 32] = [
    0xce, 0xe0, 0x30, 0x2d, 0x59, 0x84, 0x4d, 0x32, 0xbd, 0xca, 0x91, 0x5c, 0x82, 0x03, 0xdd, 0x44,
    0xb3, 0x3f, 0xbb, 0x7e, 0xdc, 0x19, 0x05, 0x1e, 0xa3, 0x7a, 0xbe, 0xdf, 0x28, 0xec, 0xd4, 0x72,
];

pub const START_LEDGER: u32 = 1_000_000;
pub const MAX_BALANCE: i128 = 10_000_000_000;
pub const MIN_DEPOSIT: i128 = 10_000_000;
pub const XLM: i128 = 10_000_000;

/// Deterministic ed25519 key from a label.
pub fn signing_key(label: &str) -> SigningKey {
    use sha2::{Digest, Sha256};
    let seed: [u8; 32] = Sha256::digest(label.as_bytes()).into();
    SigningKey::from_bytes(&seed)
}

pub fn public_key(e: &Env, key: &SigningKey) -> BytesN<32> {
    BytesN::from_array(e, &key.verifying_key().to_bytes())
}

pub fn root(e: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(e, &[n; 32])
}

pub struct Fixture {
    pub e: Env,
    pub tab: Address,
    pub token: Address,
    pub issuer: Address,
    pub admin: Address,
    pub pauser: Address,
    pub upgrader: Address,
    pub settler: Address,
    pub treasury: Address,
    pub acceptor: SigningKey,
    /// Set only by the vector tests, whose readers are G addresses: `mock_auths`
    /// cannot mock an account address, so those tests use `mock_all_auths`.
    pub all_auths: bool,
}

impl Fixture {
    pub fn new() -> Self {
        Self::with_env(Env::default())
    }

    /// A fixture whose `Env` writes no test snapshot (property and resource tests).
    pub fn quiet() -> Self {
        Self::with_env(Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        }))
    }

    pub fn with_env(e: Env) -> Self {
        e.ledger().set_sequence_number(START_LEDGER);
        e.ledger().set_network_id(TESTNET_NETWORK_ID);
        let issuer = Address::generate(&e);
        let token = e
            .register_stellar_asset_contract_v2(issuer.clone())
            .address();
        let admin = Address::generate(&e);
        let pauser = Address::generate(&e);
        let upgrader = Address::generate(&e);
        let settler = Address::generate(&e);
        let treasury = Address::generate(&e);
        let acceptor = signing_key("acceptor");
        let tab = e.register(
            QuillTipTab,
            (
                &admin,
                &pauser,
                &upgrader,
                &settler,
                &token,
                &treasury,
                MAX_BALANCE,
                MIN_DEPOSIT,
                public_key(&e, &acceptor),
            ),
        );
        Fixture {
            e,
            tab,
            token,
            issuer,
            admin,
            pauser,
            upgrader,
            settler,
            treasury,
            acceptor,
            all_auths: false,
        }
    }

    pub fn client(&self) -> QuillTipTabClient<'_> {
        QuillTipTabClient::new(&self.e, &self.tab)
    }

    pub fn token_client(&self) -> TokenClient<'_> {
        TokenClient::new(&self.e, &self.token)
    }

    pub fn balance(&self, who: &Address) -> i128 {
        self.token_client().balance(who)
    }

    pub fn now(&self) -> u32 {
        self.e.ledger().sequence()
    }

    pub fn advance(&self, ledgers: u32) {
        self.e.ledger().set_sequence_number(self.now() + ledgers);
    }

    /// Authorises exactly one root invocation of the Tab by `who`.
    pub fn auth(&self, who: &Address, fn_name: &str, args: Vec<Val>) {
        if self.all_auths {
            return;
        }
        self.e.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &self.tab,
                fn_name,
                args,
                sub_invokes: &[],
            },
        }]);
    }

    /// Authorises a Tab root invocation that moves `amount` from `who` to the Tab.
    pub fn auth_with_transfer(&self, who: &Address, fn_name: &str, args: Vec<Val>, amount: i128) {
        if self.all_auths {
            return;
        }
        let transfer = [MockAuthInvoke {
            contract: &self.token,
            fn_name: "transfer",
            args: (who.clone(), self.tab.clone(), amount).into_val(&self.e),
            sub_invokes: &[],
        }];
        self.e.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &self.tab,
                fn_name,
                args,
                sub_invokes: &transfer,
            },
        }]);
    }

    pub fn mint(&self, to: &Address, amount: i128) {
        self.e.mock_auths(&[MockAuth {
            address: &self.issuer,
            invoke: &MockAuthInvoke {
                contract: &self.token,
                fn_name: "mint",
                args: (to.clone(), amount).into_val(&self.e),
                sub_invokes: &[],
            },
        }]);
        StellarAssetClient::new(&self.e, &self.token).mint(to, &amount);
    }

    /// A funded reader with `deposit` in the tab and one session key (`key_id` returned).
    pub fn reader(&self, deposit: i128, spend_limit: i128) -> (Address, SigningKey, u32) {
        let reader = Address::generate(&self.e);
        let key = key_for(&reader);
        self.mint(&reader, MAX_BALANCE);
        let valid_until = self.now() + 7 * quilltip_shared::DAY;
        let key_id = self.open_session(&reader, deposit, &key, valid_until, spend_limit);
        (reader, key, key_id)
    }

    pub fn open_session(
        &self,
        reader: &Address,
        amount: i128,
        key: &SigningKey,
        valid_until: u32,
        spend_limit: i128,
    ) -> u32 {
        let pk = public_key(&self.e, key);
        let args = (reader.clone(), amount, pk.clone(), valid_until, spend_limit).into_val(&self.e);
        if amount > 0 {
            self.auth_with_transfer(reader, "open_session", args, amount);
        } else {
            self.auth(reader, "open_session", args);
        }
        self.client()
            .open_session(reader, &amount, &pk, &valid_until, &spend_limit)
    }

    pub fn deposit(&self, reader: &Address, amount: i128) {
        self.auth_with_transfer(
            reader,
            "deposit",
            (reader.clone(), amount).into_val(&self.e),
            amount,
        );
        self.client().deposit(reader, &amount);
    }

    /// Payload bytes for explicit network and contract values.
    #[allow(clippy::too_many_arguments)]
    pub fn payload_for(
        &self,
        tab: &Address,
        network_id: [u8; 32],
        reader: &Address,
        writer: &Address,
        key_id: u32,
        key: &SigningKey,
        cumulative: i128,
        receipts_root: &BytesN<32>,
    ) -> soroban_sdk::Bytes {
        VoucherPayload::new(
            &self.e,
            tab.clone(),
            BytesN::from_array(&self.e, &network_id),
            reader.clone(),
            writer.clone(),
            key_id,
            public_key(&self.e, key),
            cumulative,
            receipts_root.clone(),
        )
        .to_bytes(&self.e)
    }

    pub fn sign(&self, key: &SigningKey, bytes: &soroban_sdk::Bytes) -> BytesN<64> {
        let mut buf = std::vec![0u8; bytes.len() as usize];
        bytes.copy_into_slice(&mut buf);
        BytesN::from_array(&self.e, &key.sign(&buf).to_bytes())
    }

    /// A voucher signed for this Tab and network.
    pub fn voucher(
        &self,
        reader: &Address,
        writer: &Address,
        key_id: u32,
        key: &SigningKey,
        cumulative: i128,
    ) -> Voucher {
        let r = root(&self.e, (cumulative % 251) as u8);
        let bytes = self.payload_for(
            &self.tab,
            TESTNET_NETWORK_ID,
            reader,
            writer,
            key_id,
            key,
            cumulative,
            &r,
        );
        Voucher {
            reader: reader.clone(),
            writer: writer.clone(),
            key_id,
            cumulative,
            receipts_root: r,
            signature: self.sign(key, &bytes),
            acceptor: None,
            acceptance_signature: None,
        }
    }

    /// Adds an acceptance countersignature by `acceptor` to a voucher.
    pub fn accept(&self, v: &Voucher, key: &SigningKey, acceptor: &SigningKey) -> Voucher {
        let bytes = self.payload_for(
            &self.tab,
            TESTNET_NETWORK_ID,
            &v.reader,
            &v.writer,
            v.key_id,
            key,
            v.cumulative,
            &v.receipts_root,
        );
        let accept = AcceptancePayload::for_voucher_bytes(&self.e, &bytes).to_bytes(&self.e);
        let mut out = v.clone();
        out.acceptor = Some(public_key(&self.e, acceptor));
        out.acceptance_signature = Some(self.sign(acceptor, &accept));
        out
    }

    pub fn settle(&self, vouchers: &Vec<Voucher>) -> crate::SettleSummary {
        self.auth(
            &self.settler,
            "settle",
            (self.settler.clone(), vouchers.clone()).into_val(&self.e),
        );
        self.client().settle(&self.settler, vouchers)
    }

    pub fn try_settle(&self, vouchers: &Vec<Voucher>) -> Outcome {
        self.auth(
            &self.settler,
            "settle",
            (self.settler.clone(), vouchers.clone()).into_val(&self.e),
        );
        Outcome::from(self.client().try_settle(&self.settler, vouchers))
    }

    pub fn try_settle_own(&self, writer: &Address, vouchers: &Vec<Voucher>) -> Outcome {
        self.auth(
            writer,
            "settle_own",
            (writer.clone(), vouchers.clone()).into_val(&self.e),
        );
        Outcome::from(self.client().try_settle_own(writer, vouchers))
    }

    /// Tab events of the last invocation, as XDR.
    pub fn tab_events(&self) -> std::vec::Vec<soroban_sdk::xdr::ContractEvent> {
        self.e
            .events()
            .all()
            .filter_by_contract(&self.tab)
            .events()
            .to_vec()
    }

    pub fn settle_own(&self, writer: &Address, vouchers: &Vec<Voucher>) -> crate::SettleSummary {
        self.auth(
            writer,
            "settle_own",
            (writer.clone(), vouchers.clone()).into_val(&self.e),
        );
        self.client().settle_own(writer, vouchers)
    }

    pub fn claim(&self, who: &Address) -> i128 {
        self.client().claim(who)
    }

    pub fn withdraw_start(&self, reader: &Address) {
        self.auth(
            reader,
            "withdraw_start",
            (reader.clone(),).into_val(&self.e),
        );
        self.client().withdraw_start(reader);
    }

    pub fn withdraw(&self, reader: &Address) -> i128 {
        self.auth(reader, "withdraw", (reader.clone(),).into_val(&self.e));
        self.client().withdraw(reader)
    }

    pub fn pause(&self) {
        self.auth(
            &self.pauser,
            "pause",
            (self.pauser.clone(),).into_val(&self.e),
        );
        self.client().pause(&self.pauser);
    }

    pub fn unpause(&self) {
        self.auth(
            &self.admin,
            "unpause",
            (self.admin.clone(),).into_val(&self.e),
        );
        self.client().unpause(&self.admin);
    }

    /// Σ reader balances + Σ claimable for the given parties.
    pub fn ledger_sum(&self, readers: &[Address], payees: &[Address]) -> i128 {
        let c = self.client();
        let balances: i128 = readers
            .iter()
            .map(|r| c.account(r).map(|a| a.balance).unwrap_or(0))
            .sum();
        let claimable: i128 = payees.iter().map(|p| c.claimable(p)).sum();
        balances + claimable
    }
}

/// Result of a `try_settle` or `try_settle_own` call.
#[derive(Debug, PartialEq)]
pub enum Outcome {
    Ok(crate::SettleSummary),
    /// A `TabError` returned by the contract.
    Tab(crate::TabError),
    /// Any other failure: a host trap (invalid signature), an auth or role failure.
    Aborted,
}

type TryResult = Result<
    Result<crate::SettleSummary, soroban_sdk::ConversionError>,
    Result<soroban_sdk::Error, soroban_sdk::InvokeError>,
>;

/// The `TabError` carried by a host error, if it is one.
pub fn tab_error(err: &soroban_sdk::Error) -> Option<crate::TabError> {
    if err.is_type(soroban_sdk::xdr::ScErrorType::Contract)
        && quilltip_shared::errors::TAB.contains(err.get_code())
    {
        crate::TabError::try_from(*err).ok()
    } else {
        None
    }
}

impl From<TryResult> for Outcome {
    fn from(r: TryResult) -> Self {
        match r {
            Ok(Ok(s)) => Outcome::Ok(s),
            Err(Ok(e)) => tab_error(&e).map(Outcome::Tab).unwrap_or(Outcome::Aborted),
            _ => Outcome::Aborted,
        }
    }
}

pub fn summary(settled: u32, skipped: u32, gross: i128, fee: i128) -> Outcome {
    Outcome::Ok(crate::SettleSummary {
        settled,
        skipped,
        gross,
        fee,
    })
}

pub fn vec1(e: &Env, v: Voucher) -> Vec<Voucher> {
    let mut out = Vec::new(e);
    out.push_back(v);
    out
}

/// Deterministic session key derived from an address, so snapshots stay stable.
pub fn key_for(addr: &Address) -> SigningKey {
    let s = addr.to_string();
    let mut buf = std::vec![0u8; s.len() as usize];
    s.copy_into_slice(&mut buf);
    signing_key(core::str::from_utf8(&buf).unwrap())
}

/// Asserts that a `try_` call failed with this Tab error.
#[macro_export]
macro_rules! assert_tab_err {
    ($call:expr, $err:expr) => {
        match $call {
            Err(Ok(e)) => assert_eq!($crate::test::tab_error(&e), Some($err)),
            other => panic!("expected {:?}, got ok={:?}", $err, other.is_ok()),
        }
    };
}
