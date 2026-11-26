//! Exact topics and data of every Core event (section 2.4; I-9).

use soroban_sdk::{
    testutils::{Address as _, Events as _},
    vec, xdr, Address, Event, Symbol,
};

use super::*;
use crate::events::*;

/// Events emitted by Core in the last invocation.
fn core_events(f: &Fixture) -> std::vec::Vec<xdr::ContractEvent> {
    f.e.events()
        .all()
        .filter_by_contract(&f.id())
        .events()
        .to_vec()
}

fn assert_events(f: &Fixture, expected: &[&dyn Event]) {
    let want: std::vec::Vec<xdr::ContractEvent> =
        expected.iter().map(|ev| ev.to_xdr(&f.e, &f.id())).collect();
    assert_eq!(core_events(f), want);
}

fn first_topic(event: &xdr::ContractEvent) -> xdr::ScVal {
    let xdr::ContractEventBody::V0(body) = &event.body;
    body.topics[0].clone()
}

#[test]
fn constructor_emits_token_set_and_treasury_set() {
    let e = Env::default();
    e.mock_all_auths();
    let a = Address::generate(&e);
    let treasury = Address::generate(&e);
    let token = e.register_stellar_asset_contract_v2(a.clone()).address();
    let id = e.register(QuillTipCore, (&a, &a, &a, &treasury, &token, MIN_TIP));
    let got = e.events().all().filter_by_contract(&id).events().to_vec();
    let token_set = TokenSet {
        token: token.clone(),
        min_tip: MIN_TIP,
        enabled: true,
    }
    .to_xdr(&e, &id);
    let treasury_set = TreasurySet {
        previous: None,
        new: treasury,
    }
    .to_xdr(&e, &id);
    assert!(got.contains(&token_set), "TokenSet");
    assert!(got.contains(&treasury_set), "TreasurySet");
}

#[test]
fn registration_events() {
    let f = Fixture::new();
    let e = &f.e;
    let author = Address::generate(e);
    let co = Address::generate(e);
    let article_ref = random_id(e);
    let s = splits(e, &[author.clone(), co.clone()], &[8_000, 2_000]);
    let id = f
        .core
        .register_article(&author, &article_ref, &hash(e, 1), &Some(hash(e, 2)), &s);
    assert_events(
        &f,
        &[&ArticleRegistered {
            article_id: id.clone(),
            author: author.clone(),
            article_ref: article_ref.clone(),
            content_hash: hash(e, 1),
            arweave_id: Some(hash(e, 2)),
            splits: s.clone(),
        }],
    );
    assert_eq!(
        first_topic(&core_events(&f)[0]),
        xdr::ScVal::Symbol(xdr::ScSymbol("article_registered".try_into().unwrap()))
    );

    f.core.update_content(&id, &hash(e, 3), &None);
    assert_events(
        &f,
        &[&ContentUpdated {
            article_id: id.clone(),
            content_hash: hash(e, 3),
            arweave_id: None,
            content_version: 2,
        }],
    );

    f.core.set_splits(&id, &vec![e]);
    assert_events(
        &f,
        &[&SplitsSet {
            article_id: id.clone(),
            splits: vec![e],
        }],
    );

    let new = Address::generate(e);
    f.core.propose_author(&id, &new, &(START_LEDGER + 50));
    assert_events(
        &f,
        &[&AuthorProposed {
            article_id: id.clone(),
            new_author: new.clone(),
            live_until_ledger: START_LEDGER + 50,
        }],
    );

    f.core.cancel_author_proposal(&id);
    assert_events(
        &f,
        &[&AuthorProposalCancelled {
            article_id: id.clone(),
            new_author: new.clone(),
        }],
    );

    f.core.propose_author(&id, &new, &(START_LEDGER + 50));
    f.core.accept_author(&id);
    assert_events(
        &f,
        &[&AuthorChanged {
            article_id: id.clone(),
            previous: author,
            new,
        }],
    );
}

#[test]
fn tipped_event_fields() {
    let f = Fixture::new();
    let e = &f.e;
    let (id, r) = f.article_with_splits(&[7_000, 3_000]);
    f.core.update_content(&id, &hash(e, 5), &None);
    let tipper = f.funded();
    let gross: i128 = 4_000_001;
    f.core.tip(
        &tipper,
        &id,
        &f.token,
        &gross,
        &Some(hash(e, 9)),
        &client_ref(e, 3),
    );
    let fee = gross * 250 / 10_000;
    assert_events(
        &f,
        &[&Tipped {
            article_id: id.clone(),
            author: r[0].clone(),
            tipper: tipper.clone(),
            token: f.token.clone(),
            gross,
            fee,
            net: gross - fee,
            highlight_id: Some(hash(e, 9)),
            content_hash: hash(e, 5),
            content_version: 2,
            client_ref: client_ref(e, 3),
            total_after: gross,
            split_count: 2,
        }],
    );
    // Indexer filter shape: ["tipped", article_id, author].
    let ev = &core_events(&f)[0];
    let xdr::ContractEventBody::V0(body) = &ev.body;
    assert_eq!(body.topics.len(), 3);
    assert_eq!(
        body.topics[0],
        xdr::ScVal::Symbol(xdr::ScSymbol("tipped".try_into().unwrap()))
    );
}

/// I-9: exactly one `Tipped` per batch item, in input order.
#[test]
fn batch_emits_one_tipped_per_item() {
    let f = Fixture::new();
    let e = &f.e;
    let (a, author_a) = f.article();
    let (b, author_b) = f.article();
    let tipper = f.funded();
    let list = super::batch::items(
        &f,
        &[
            super::batch::item(&f, &a, MIN_TIP, 1),
            super::batch::item(&f, &b, 2 * MIN_TIP, 2),
            super::batch::item(&f, &a, MIN_TIP, 3),
        ],
    );
    f.core.tip_batch(&tipper, &f.token, &list);
    let mk = |id: &BytesN<32>, author: &Address, gross: i128, n: u32, total: i128| Tipped {
        article_id: id.clone(),
        author: author.clone(),
        tipper: tipper.clone(),
        token: f.token.clone(),
        gross,
        fee: gross / 40,
        net: gross - gross / 40,
        highlight_id: Some(hash(e, n as u8)),
        content_hash: hash(e, 1),
        content_version: 1,
        client_ref: client_ref(e, n),
        total_after: total,
        split_count: 0,
    };
    assert_events(
        &f,
        &[
            &mk(&a, &author_a, MIN_TIP, 1, MIN_TIP),
            &mk(&b, &author_b, 2 * MIN_TIP, 2, 2 * MIN_TIP),
            &mk(&a, &author_a, MIN_TIP, 3, 2 * MIN_TIP),
        ],
    );
}

#[test]
fn admin_events() {
    let f = Fixture::new();
    let t = f.new_token();
    f.core.set_token(&t, &MIN_TIP, &false);
    assert_events(
        &f,
        &[&TokenSet {
            token: t.clone(),
            min_tip: MIN_TIP,
            enabled: false,
        }],
    );
    f.core.remove_token(&t);
    assert_events(&f, &[&TokenRemoved { token: t }]);

    let new_treasury = Address::generate(&f.e);
    f.core.set_treasury(&new_treasury);
    assert_events(
        &f,
        &[&TreasurySet {
            previous: Some(f.treasury.clone()),
            new: new_treasury,
        }],
    );
}

/// OpenZeppelin pause events are emitted by Core.
#[test]
fn pause_events() {
    let f = Fixture::new();
    f.core.pause(&f.pauser);
    let got = core_events(&f);
    assert_eq!(got.len(), 1);
    assert_eq!(
        first_topic(&got[0]),
        xdr::ScVal::Symbol(xdr::ScSymbol("paused".try_into().unwrap()))
    );
    let _ = Symbol::new(&f.e, "paused");
}
