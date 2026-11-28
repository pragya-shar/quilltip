//! Authorisation with explicit `mock_auths` trees, never `mock_all_auths`
//! (I-7, I-26; section 8.1 "Auth").
//!
//! Each case signs the exact invocation with the required address and
//! succeeds, then signs the same invocation with another address and fails.

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, MockAuth, MockAuthInvoke},
    vec, Address, IntoVal, Symbol, Val,
};

use super::*;
use crate::TipInput;

fn mock<'a>(
    who: &'a Address,
    contract: &'a Address,
    fn_name: &'a str,
    args: Vec<Val>,
    sub: &'a [MockAuthInvoke<'a>],
) -> (Address, MockAuthInvoke<'a>) {
    (
        who.clone(),
        MockAuthInvoke {
            contract,
            fn_name,
            args,
            sub_invokes: sub,
        },
    )
}

/// Runs `$call` on a client whose only authorisation is `who` signing the
/// exact invocation (no sub-invocations).
macro_rules! signed {
    ($f:expr, $who:expr, $fn_name:expr, $args:expr, $c:ident => $call:expr) => {{
        let contract = $f.id();
        let invoke = MockAuthInvoke {
            contract: &contract,
            fn_name: $fn_name,
            args: $args,
            sub_invokes: &[],
        };
        let auths = [MockAuth {
            address: $who,
            invoke: &invoke,
        }];
        let $c = $f.core.mock_auths(&auths);
        $call
    }};
}

#[test]
fn register_article_requires_author() {
    let f = Fixture::new();
    let e = &f.e;
    let author = Address::generate(e);
    let other = Address::generate(e);
    let id = random_id(e);
    let args = (
        &author,
        &id,
        hash(e, 1),
        None::<BytesN<32>>,
        Vec::<Split>::new(e),
    )
        .into_val(e);
    assert!(signed!(f, &other, "register_article", args, c => c.try_register_article(&author, &id, &hash(e, 1), &None, &vec![e]))
        .is_err());
    let args = (
        &author,
        &id,
        hash(e, 1),
        None::<BytesN<32>>,
        Vec::<Split>::new(e),
    )
        .into_val(e);
    signed!(f, &author, "register_article", args, c => c.register_article(
        &author,
        &id,
        &hash(e, 1),
        &None,
        &vec![e],
    ));
}

/// I-7: only the stored author updates content, splits and proposals.
#[test]
fn author_only_operations() {
    let f = Fixture::new();
    let e = &f.e;
    let (id, author) = f.article();
    let other = Address::generate(e);

    let args = (&id, hash(e, 2), None::<BytesN<32>>).into_val(e);
    assert!(signed!(f, &other, "update_content", args, c => c.try_update_content(&id, &hash(e, 2), &None))
        .is_err());
    let args = (&id, hash(e, 2), None::<BytesN<32>>).into_val(e);
    signed!(f, &author, "update_content", args, c => c.update_content(&id, &hash(e, 2), &None));

    let s = splits(e, &[author.clone(), other.clone()], &[5_000, 5_000]);
    let args = (&id, s.clone()).into_val(e);
    assert!(signed!(f, &other, "set_splits", args, c => c.try_set_splits(&id, &s)).is_err());
    let args = (&id, s.clone()).into_val(e);
    signed!(f, &author, "set_splits", args, c => c.set_splits(&id, &s));

    let new = Address::generate(e);
    let until = START_LEDGER + 10;
    let args = (&id, &new, until).into_val(e);
    assert!(
        signed!(f, &other, "propose_author", args, c => c.try_propose_author(&id, &new, &until))
            .is_err()
    );
    let args = (&id, &new, until).into_val(e);
    signed!(f, &author, "propose_author", args, c => c.propose_author(&id, &new, &until));

    let args = (&id,).into_val(e);
    assert!(
        signed!(f, &other, "cancel_author_proposal", args, c => c.try_cancel_author_proposal(&id))
            .is_err()
    );
    let args = (&id,).into_val(e);
    signed!(f, &author, "cancel_author_proposal", args, c => c.cancel_author_proposal(&id));
}

/// I-7: acceptance needs the proposed author, not the old author.
#[test]
fn accept_author_requires_new_author() {
    let f = Fixture::new();
    let e = &f.e;
    let (id, author) = f.article();
    let new = Address::generate(e);
    f.core.propose_author(&id, &new, &(START_LEDGER + 10));
    let args = (&id,).into_val(e);
    assert!(signed!(f, &author, "accept_author", args, c => c.try_accept_author(&id)).is_err());
    let args = (&id,).into_val(e);
    signed!(f, &new, "accept_author", args, c => c.accept_author(&id));
    assert_eq!(f.core.article_author(&id), new);
}

/// The tip auth tree covers the SAC `transfer` sub-invocations. The tree
/// recorded by the host equals the expected one.
#[test]
fn tip_auth_tree_includes_sac_transfers() {
    let f = Fixture::new();
    let e = &f.e;
    let (id, author) = f.article();
    let tipper = f.funded();
    let gross: i128 = 10_000_000;
    let (fee, net) = (gross / 40, gross - gross / 40);
    let r = client_ref(e, 1);
    let tip_args: Vec<Val> =
        (&tipper, &id, &f.token, gross, Some(hash(e, 4)), r.clone()).into_val(e);

    let subs = [
        MockAuthInvoke {
            contract: &f.token,
            fn_name: "transfer",
            args: (&tipper, &author, net).into_val(e),
            sub_invokes: &[],
        },
        MockAuthInvoke {
            contract: &f.token,
            fn_name: "transfer",
            args: (&tipper, &f.treasury, fee).into_val(e),
            sub_invokes: &[],
        },
    ];

    // Without the transfer sub-invocations the tip fails.
    let core_id = f.id();
    let (who, bare) = mock(&tipper, &core_id, "tip", tip_args.clone(), &[]);
    assert!(f
        .core
        .mock_auths(&[MockAuth {
            address: &who,
            invoke: &bare
        }])
        .try_tip(&tipper, &id, &f.token, &gross, &Some(hash(e, 4)), &r)
        .is_err());

    let (who, full) = mock(&tipper, &core_id, "tip", tip_args.clone(), &subs);
    f.core
        .mock_auths(&[MockAuth {
            address: &who,
            invoke: &full,
        }])
        .tip(&tipper, &id, &f.token, &gross, &Some(hash(e, 4)), &r);

    assert_eq!(
        e.auths(),
        std::vec![(
            tipper.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((f.id(), Symbol::new(e, "tip"), tip_args,)),
                sub_invocations: std::vec![
                    AuthorizedInvocation {
                        function: AuthorizedFunction::Contract((
                            f.token.clone(),
                            symbol_short!("transfer"),
                            (&tipper, &author, net).into_val(e),
                        )),
                        sub_invocations: std::vec![],
                    },
                    AuthorizedInvocation {
                        function: AuthorizedFunction::Contract((
                            f.token.clone(),
                            symbol_short!("transfer"),
                            (&tipper, &f.treasury, fee).into_val(e),
                        )),
                        sub_invocations: std::vec![],
                    },
                ],
            }
        )]
    );
}

/// A batch needs one tipper signature covering every transfer.
#[test]
fn tip_batch_single_signature() {
    let f = Fixture::new();
    let e = &f.e;
    let (a, author_a) = f.article();
    let (b, author_b) = f.article();
    let tipper = f.funded();
    let other = f.funded();
    let items: Vec<TipInput> = vec![
        e,
        TipInput {
            article_id: a.clone(),
            amount: MIN_TIP,
            highlight_id: None,
            client_ref: client_ref(e, 1),
        },
        TipInput {
            article_id: b.clone(),
            amount: MIN_TIP,
            highlight_id: None,
            client_ref: client_ref(e, 2),
        },
    ];
    let (fee, net) = (MIN_TIP / 40, MIN_TIP - MIN_TIP / 40);
    let subs = [
        MockAuthInvoke {
            contract: &f.token,
            fn_name: "transfer",
            args: (&tipper, &author_a, net).into_val(e),
            sub_invokes: &[],
        },
        MockAuthInvoke {
            contract: &f.token,
            fn_name: "transfer",
            args: (&tipper, &f.treasury, fee).into_val(e),
            sub_invokes: &[],
        },
        MockAuthInvoke {
            contract: &f.token,
            fn_name: "transfer",
            args: (&tipper, &author_b, net).into_val(e),
            sub_invokes: &[],
        },
        MockAuthInvoke {
            contract: &f.token,
            fn_name: "transfer",
            args: (&tipper, &f.treasury, fee).into_val(e),
            sub_invokes: &[],
        },
    ];
    let args: Vec<Val> = (&tipper, &f.token, items.clone()).into_val(e);

    let core_id = f.id();
    let (who, wrong) = mock(&other, &core_id, "tip_batch", args.clone(), &subs);
    assert!(f
        .core
        .mock_auths(&[MockAuth {
            address: &who,
            invoke: &wrong
        }])
        .try_tip_batch(&tipper, &f.token, &items)
        .is_err());

    let (who, right) = mock(&tipper, &core_id, "tip_batch", args, &subs);
    f.core
        .mock_auths(&[MockAuth {
            address: &who,
            invoke: &right,
        }])
        .tip_batch(&tipper, &f.token, &items);
    assert_eq!(f.core.article_total(&a, &f.token), MIN_TIP);
    assert_eq!(f.core.article_total(&b, &f.token), MIN_TIP);
}

/// I-26: admin functions need the admin's signature.
#[test]
fn admin_functions_require_admin() {
    let f = Fixture::new();
    let e = &f.e;
    let other = Address::generate(e);
    let t = f.new_token();

    let args = (&t, MIN_TIP, false).into_val(e);
    assert!(
        signed!(f, &other, "set_token", args, c => c.try_set_token(&t, &MIN_TIP, &false)).is_err()
    );
    let args = (&t, MIN_TIP, false).into_val(e);
    signed!(f, &f.admin, "set_token", args, c => c.set_token(&t, &MIN_TIP, &false));

    let args = (&t,).into_val(e);
    assert!(signed!(f, &other, "remove_token", args, c => c.try_remove_token(&t)).is_err());
    let args = (&t,).into_val(e);
    signed!(f, &f.admin, "remove_token", args, c => c.remove_token(&t));

    let args = (&other,).into_val(e);
    assert!(signed!(f, &other, "set_treasury", args, c => c.try_set_treasury(&other)).is_err());
    let args = (&other,).into_val(e);
    signed!(f, &f.admin, "set_treasury", args, c => c.set_treasury(&other));
    assert_eq!(f.core.treasury(), other);
}

/// I-26: pause needs the pauser's signature, unpause the admin's.
#[test]
fn pause_and_unpause_signatures() {
    let f = Fixture::new();
    let e = &f.e;
    // The pauser address without its signature fails.
    let args = (&f.pauser,).into_val(e);
    assert!(signed!(f, &f.admin, "pause", args, c => c.try_pause(&f.pauser)).is_err());
    let args = (&f.pauser,).into_val(e);
    signed!(f, &f.pauser, "pause", args, c => c.pause(&f.pauser));

    let args = (&f.admin,).into_val(e);
    assert!(signed!(f, &f.pauser, "unpause", args, c => c.try_unpause(&f.admin)).is_err());
    let args = (&f.admin,).into_val(e);
    signed!(f, &f.admin, "unpause", args, c => c.unpause(&f.admin));
}

/// I-26: upgrade and migrate need the upgrader's signature and role.
#[test]
fn upgrader_signature() {
    let f = Fixture::new();
    let e = &f.e;
    let hash = BytesN::from_array(e, &[1; 32]);
    let args = (&hash, &f.upgrader).into_val(e);
    assert!(signed!(f, &f.admin, "upgrade", args, c => c.try_upgrade(&hash, &f.upgrader)).is_err());
    // A signed migrate by the upgrader reaches the version check.
    let args = (&f.upgrader,).into_val(e);
    assert_core_err!(
        signed!(f, &f.upgrader, "migrate", args, c => c.try_migrate(&f.upgrader)),
        CoreError::AlreadyMigrated
    );
    // The admin holds no upgrader role.
    let args = (&f.admin,).into_val(e);
    assert_eq!(
        signed!(f, &f.admin, "migrate", args, c => c.try_migrate(&f.admin)).err(),
        Some(contract_err(UNAUTHORIZED))
    );
}

/// I-26: granting a role needs the admin's signature; `renounce_admin` fails
/// even when the admin signs.
#[test]
fn role_grant_and_renounce_signatures() {
    let f = Fixture::new();
    let e = &f.e;
    let new = Address::generate(e);
    let role = Symbol::new(e, "pauser");
    let args = (&new, &role, &f.admin).into_val(e);
    assert!(
        signed!(f, &new, "grant_role", args, c => c.try_grant_role(&new, &role, &f.admin)).is_err()
    );
    let args = (&new, &role, &f.admin).into_val(e);
    signed!(f, &f.admin, "grant_role", args, c => c.grant_role(&new, &role, &f.admin));
    assert!(f.core.has_role(&new, &role).is_some());

    let args: Vec<Val> = ().into_val(e);
    assert_core_err!(
        signed!(f, &f.admin, "renounce_admin", args, c => c.try_renounce_admin()),
        CoreError::AdminRenounceDisabled
    );
}
