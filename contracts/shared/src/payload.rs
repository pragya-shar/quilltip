//! Off-chain payload types and their signed bytes (`03-tab-contract.md`, sections 3.4 and 3.6).
//!
//! A `#[contracttype]` struct encodes as an `ScVal::Map` with `Symbol` keys in
//! ascending order. Fields are declared in that order so the source reads the
//! same as the encoding. None of these types is stored on chain.

use soroban_sdk::{contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env, Symbol};

use crate::constants::{TAB_ACCEPT_DOMAIN, TAB_DOMAIN};

/// One tab tip. Kept off-chain in Convex; anchored by a voucher's `receipts_root`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TipReceipt {
    /// Gross amount, `> 0`.
    pub amount: i128,
    pub article_id: BytesN<32>,
    pub client_ref: BytesN<16>,
    pub content_hash: BytesN<32>,
    /// Σ `amount` for `seq` 1 up to and including this receipt.
    pub cumulative_after: i128,
    pub highlight_id: Option<BytesN<32>>,
    /// 1, 2, 3 … per `(reader, key_id, writer)`.
    pub seq: u32,
}

/// The message a reader's session key signs. Signed bytes = XDR of this struct.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoucherPayload {
    pub cumulative: i128,
    /// `Symbol(TAB_DOMAIN)`.
    pub domain: Symbol,
    pub key_id: u32,
    /// SHA-256 of the network passphrase.
    pub network_id: BytesN<32>,
    /// The session key's ed25519 public key.
    pub public_key: BytesN<32>,
    pub reader: Address,
    pub receipts_root: BytesN<32>,
    /// The Tab contract.
    pub tab: Address,
    pub writer: Address,
}

/// The message the Convex acceptor key countersigns.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptancePayload {
    /// `Symbol(TAB_ACCEPT_DOMAIN)`.
    pub domain: Symbol,
    /// SHA-256 of the `VoucherPayload` bytes.
    pub payload_hash: BytesN<32>,
}

impl VoucherPayload {
    /// Builds a payload with the Tab signing domain.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        e: &Env,
        tab: Address,
        network_id: BytesN<32>,
        reader: Address,
        writer: Address,
        key_id: u32,
        public_key: BytesN<32>,
        cumulative: i128,
        receipts_root: BytesN<32>,
    ) -> Self {
        VoucherPayload {
            cumulative,
            domain: Symbol::new(e, TAB_DOMAIN),
            key_id,
            network_id,
            public_key,
            reader,
            receipts_root,
            tab,
            writer,
        }
    }

    /// The exact bytes a session key signs (no pre-hash).
    pub fn to_bytes(&self, e: &Env) -> Bytes {
        self.clone().to_xdr(e)
    }
}

impl AcceptancePayload {
    /// Builds the acceptance payload for the given voucher payload bytes.
    pub fn for_voucher_bytes(e: &Env, voucher_bytes: &Bytes) -> Self {
        AcceptancePayload {
            domain: Symbol::new(e, TAB_ACCEPT_DOMAIN),
            payload_hash: e.crypto().sha256(voucher_bytes).to_bytes(),
        }
    }

    /// The exact bytes the acceptor key signs.
    pub fn to_bytes(&self, e: &Env) -> Bytes {
        self.clone().to_xdr(e)
    }
}

impl TipReceipt {
    /// XDR of the receipt as an `ScVal::Map`.
    pub fn to_bytes(&self, e: &Env) -> Bytes {
        self.clone().to_xdr(e)
    }
}
