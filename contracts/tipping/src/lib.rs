#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, token, vec, Address, Env, String, Symbol,
    Vec,
};
use stellar_contract_utils::pausable;

#[derive(Clone)]
#[contracttype]
pub struct SimpleTip {
    pub tipper: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct TipReceipt {
    pub tip_id: u64,
    pub amount_sent: i128,
    pub author_received: i128,
    pub platform_fee: i128,
    pub timestamp: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct ArticleTipInput {
    pub article_id: Symbol,
    pub author: Address,
    pub amount: i128,
}

#[derive(Clone)]
#[contracttype]
pub struct HighlightTipInput {
    pub highlight_id: String,
    pub article_id: Symbol,
    pub author: Address,
    pub amount: i128,
}

#[derive(Clone)]
#[contracttype]
pub struct BatchTipReceipt {
    pub receipts: Vec<TipReceipt>,
    pub total_amount: i128,
    pub total_author_received: i128,
    pub total_platform_fee: i128,
}

#[contractevent(topics = ["tip_with_arweave"], data_format = "single-value")]
pub struct TipWithArweave {
    #[topic]
    pub article_id: Symbol,
    pub data: (Address, Address, i128, String),
}

#[contractevent(topics = ["highlight_tip_arweave"], data_format = "single-value")]
pub struct HighlightTipArweave {
    #[topic]
    pub highlight_id: String,
    pub data: (Address, Address, i128, String),
}

#[contractevent(topics = ["batch_tip"], data_format = "single-value")]
pub struct BatchTipEvent {
    pub data: (Address, Symbol, Address, i128, i128, i128, u64),
}

#[contractevent(topics = ["batch_tip_highlights"], data_format = "single-value")]
pub struct BatchHighlightTipEvent {
    pub data: (Address, String, Symbol, Address, i128, i128, i128, u64),
}

#[derive(Clone)]
#[contracttype]
pub struct HighlightTip {
    pub highlight_id: String, // Unique highlight identifier (SHA256)
    pub article_id: Symbol,   // Parent article (Convex ID - alphanumeric, Symbol-safe)
    pub tipper: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    PlatformAddress,
    TokenAddress,
    PlatformFeeBps,
    ArticleTips(Symbol),
    ArticleTotalTips(Symbol), // Track total tips per article for NFT threshold
    TipCounter,
    TotalVolume,
    HighlightTips(String), // Highlight ID → Tips
    Paused,                // Emergency pause state (OZ Pausable)
}

const MINIMUM_TIP_STROOPS: i128 = 100_000; // 0.01 XLM (approximately 1 cent)
const DEFAULT_PLATFORM_FEE_BPS: u32 = 250; // 2.5%

fn validate_minimum_tip(amount: i128) {
    if amount < MINIMUM_TIP_STROOPS {
        panic!("Amount below minimum tip");
    }
}

fn calculate_tip_split(amount: i128, platform_fee_bps: u32) -> (i128, i128) {
    let platform_fee = (amount * platform_fee_bps as i128) / 10_000;
    let author_share = amount - platform_fee;
    (author_share, platform_fee)
}

fn get_token_address(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::TokenAddress)
        .expect("Token address not set")
}

#[contract]
pub struct TippingContract;

#[contractimpl]
impl TippingContract {
    /// Initialize the contract with platform settings
    pub fn initialize(
        env: Env,
        admin: Address,
        platform_address: Address,
        token_address: Address,
        fee_bps: Option<u32>,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }

        admin.require_auth();

        let platform_fee = fee_bps.unwrap_or(DEFAULT_PLATFORM_FEE_BPS);

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::PlatformAddress, &platform_address);
        env.storage()
            .instance()
            .set(&DataKey::TokenAddress, &token_address);
        env.storage()
            .instance()
            .set(&DataKey::PlatformFeeBps, &platform_fee);
        env.storage().persistent().set(&DataKey::TipCounter, &0u64);
        env.storage()
            .persistent()
            .set(&DataKey::TotalVolume, &0i128);
    }

    /// Send a tip for an article
    pub fn tip_article(
        env: Env,
        tipper: Address,
        article_id: Symbol,
        author: Address,
        amount: i128,
    ) -> TipReceipt {
        pausable::when_not_paused(&env);
        tipper.require_auth();

        // Validate minimum amount
        if amount < MINIMUM_TIP_STROOPS {
            panic!("Amount below minimum tip");
        }

        // Get platform settings
        let platform_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::PlatformAddress)
            .expect("Platform address not set");

        let platform_fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PlatformFeeBps)
            .unwrap_or(DEFAULT_PLATFORM_FEE_BPS);

        // Calculate fees
        let platform_fee = (amount * platform_fee_bps as i128) / 10_000;
        let author_share = amount - platform_fee;

        // Get configured token client
        let token_address = get_token_address(&env);
        let token_client = token::TokenClient::new(&env, &token_address);

        // Transfer author's share
        token_client.transfer(&tipper, &author, &author_share);

        // Transfer platform fee
        if platform_fee > 0 {
            token_client.transfer(&tipper, &platform_address, &platform_fee);
        }

        // Track cumulative tips for statistics (not balances)
        let current_total: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::ArticleTotalTips(article_id.clone()))
            .unwrap_or(0);

        env.storage().persistent().set(
            &DataKey::ArticleTotalTips(article_id.clone()),
            &(current_total + amount),
        );

        // Get and increment tip counter
        let tip_counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::TipCounter)
            .unwrap_or(0);

        let new_tip_id = tip_counter + 1;
        env.storage()
            .persistent()
            .set(&DataKey::TipCounter, &new_tip_id);

        // Store tip data
        let tip = SimpleTip {
            tipper: tipper.clone(),
            amount,
            timestamp: env.ledger().timestamp(),
        };

        // Get existing tips for article
        let mut article_tips: Vec<SimpleTip> = env
            .storage()
            .persistent()
            .get(&DataKey::ArticleTips(article_id.clone()))
            .unwrap_or(vec![&env]);

        article_tips.push_back(tip);

        env.storage()
            .persistent()
            .set(&DataKey::ArticleTips(article_id.clone()), &article_tips);

        // Update total volume
        let total_volume: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalVolume)
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::TotalVolume, &(total_volume + amount));

        // Create receipt
        TipReceipt {
            tip_id: new_tip_id,
            amount_sent: amount,
            author_received: author_share,
            platform_fee,
            timestamp: env.ledger().timestamp(),
        }
    }

    /// Send multiple article tips in one contract call.
    pub fn batch_tip(env: Env, tipper: Address, tips: Vec<ArticleTipInput>) -> BatchTipReceipt {
        pausable::when_not_paused(&env);
        tipper.require_auth();

        if tips.len() == 0 {
            panic!("Batch tip input cannot be empty");
        }

        let mut index = 0;
        while index < tips.len() {
            let tip = tips.get(index).unwrap();
            validate_minimum_tip(tip.amount);
            index += 1;
        }

        let platform_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::PlatformAddress)
            .expect("Platform address not set");

        let platform_fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PlatformFeeBps)
            .unwrap_or(DEFAULT_PLATFORM_FEE_BPS);

        let token_address = get_token_address(&env);
        let token_client = token::TokenClient::new(&env, &token_address);

        let mut receipts: Vec<TipReceipt> = vec![&env];
        let mut total_amount = 0i128;
        let mut total_author_received = 0i128;
        let mut total_platform_fee = 0i128;

        index = 0;
        while index < tips.len() {
            let tip = tips.get(index).unwrap();
            let (author_share, platform_fee) = calculate_tip_split(tip.amount, platform_fee_bps);

            token_client.transfer(&tipper, &tip.author, &author_share);

            if platform_fee > 0 {
                token_client.transfer(&tipper, &platform_address, &platform_fee);
            }

            let current_total: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::ArticleTotalTips(tip.article_id.clone()))
                .unwrap_or(0);

            env.storage().persistent().set(
                &DataKey::ArticleTotalTips(tip.article_id.clone()),
                &(current_total + tip.amount),
            );

            let tip_counter: u64 = env
                .storage()
                .persistent()
                .get(&DataKey::TipCounter)
                .unwrap_or(0);

            let new_tip_id = tip_counter + 1;
            env.storage()
                .persistent()
                .set(&DataKey::TipCounter, &new_tip_id);

            let timestamp = env.ledger().timestamp();
            let stored_tip = SimpleTip {
                tipper: tipper.clone(),
                amount: tip.amount,
                timestamp,
            };

            let mut article_tips: Vec<SimpleTip> = env
                .storage()
                .persistent()
                .get(&DataKey::ArticleTips(tip.article_id.clone()))
                .unwrap_or(vec![&env]);

            article_tips.push_back(stored_tip);

            env.storage()
                .persistent()
                .set(&DataKey::ArticleTips(tip.article_id.clone()), &article_tips);

            let total_volume: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::TotalVolume)
                .unwrap_or(0);

            env.storage()
                .persistent()
                .set(&DataKey::TotalVolume, &(total_volume + tip.amount));

            let receipt = TipReceipt {
                tip_id: new_tip_id,
                amount_sent: tip.amount,
                author_received: author_share,
                platform_fee,
                timestamp,
            };

            receipts.push_back(receipt);

            BatchTipEvent {
                data: (
                    tipper.clone(),
                    tip.article_id,
                    tip.author,
                    tip.amount,
                    author_share,
                    platform_fee,
                    new_tip_id,
                ),
            }
            .publish(&env);

            total_amount += tip.amount;
            total_author_received += author_share;
            total_platform_fee += platform_fee;
            index += 1;
        }

        BatchTipReceipt {
            receipts,
            total_amount,
            total_author_received,
            total_platform_fee,
        }
    }

    /// Get all tips for an article
    pub fn get_article_tips(env: Env, article_id: Symbol) -> Vec<SimpleTip> {
        env.storage()
            .persistent()
            .get(&DataKey::ArticleTips(article_id))
            .unwrap_or(vec![&env])
    }

    /// Get author's balance from the configured token
    pub fn get_balance(env: Env, author: Address) -> i128 {
        let token_address = get_token_address(&env);
        let token_client = token::TokenClient::new(&env, &token_address);
        token_client.balance(&author)
    }

    /// Get total tips for an article (for NFT threshold checking)
    pub fn get_article_total_tips(env: Env, article_id: Symbol) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::ArticleTotalTips(article_id))
            .unwrap_or(0)
    }

    /// Check if article has reached NFT minting threshold
    pub fn is_nft_eligible(env: Env, article_id: Symbol, threshold: i128) -> bool {
        let total_tips = Self::get_article_total_tips(env, article_id);
        total_tips >= threshold
    }

    /// Withdraw is no longer needed - transfers happen immediately
    /// Keeping for backwards compatibility, returns 0
    pub fn withdraw_earnings(_env: Env, author: Address) -> i128 {
        author.require_auth();
        // Transfers happen immediately in tip_article
        // This function is deprecated but kept for backwards compatibility
        0
    }

    /// Get total tips volume
    pub fn get_total_volume(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalVolume)
            .unwrap_or(0)
    }

    /// Update platform fee (admin only)
    pub fn update_fee(env: Env, admin: Address, new_fee_bps: u32) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");

        if admin != stored_admin {
            panic!("Unauthorized");
        }

        if new_fee_bps > 1000 {
            // Max 10%
            panic!("Fee too high");
        }

        env.storage()
            .instance()
            .set(&DataKey::PlatformFeeBps, &new_fee_bps);
    }

    /// Tip a highlight directly (same flow as tip_article)
    pub fn tip_highlight_direct(
        env: Env,
        tipper: Address,
        highlight_id: String,
        article_id: Symbol,
        author: Address,
        amount: i128,
    ) -> TipReceipt {
        pausable::when_not_paused(&env);
        tipper.require_auth();

        // Validate minimum amount
        if amount < MINIMUM_TIP_STROOPS {
            panic!("Amount below minimum tip");
        }

        // Get platform settings (reuse existing code)
        let platform_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::PlatformAddress)
            .expect("Platform address not set");

        let platform_fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PlatformFeeBps)
            .unwrap_or(DEFAULT_PLATFORM_FEE_BPS);

        // Calculate fees (same as tip_article)
        let platform_fee = (amount * platform_fee_bps as i128) / 10_000;
        let author_share = amount - platform_fee;

        // Get configured token client (same as tip_article)
        let token_address = get_token_address(&env);
        let token_client = token::TokenClient::new(&env, &token_address);

        // Transfer author's share
        token_client.transfer(&tipper, &author, &author_share);

        // Transfer platform fee
        if platform_fee > 0 {
            token_client.transfer(&tipper, &platform_address, &platform_fee);
        }

        // Get and increment tip counter (same as tip_article)
        let tip_counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::TipCounter)
            .unwrap_or(0);

        let new_tip_id = tip_counter + 1;
        env.storage()
            .persistent()
            .set(&DataKey::TipCounter, &new_tip_id);

        // Store highlight tip
        let tip = HighlightTip {
            highlight_id: highlight_id.clone(),
            article_id,
            tipper: tipper.clone(),
            amount,
            timestamp: env.ledger().timestamp(),
        };

        // Get existing tips for highlight
        let mut highlight_tips: Vec<HighlightTip> = env
            .storage()
            .persistent()
            .get(&DataKey::HighlightTips(highlight_id.clone()))
            .unwrap_or(vec![&env]);

        highlight_tips.push_back(tip);

        env.storage()
            .persistent()
            .set(&DataKey::HighlightTips(highlight_id), &highlight_tips);

        // Create receipt (same format as tip_article)
        TipReceipt {
            tip_id: new_tip_id,
            amount_sent: amount,
            author_received: author_share,
            platform_fee,
            timestamp: env.ledger().timestamp(),
        }
    }

    /// Send multiple highlight tips in one contract call.
    pub fn batch_tip_highlights(
        env: Env,
        tipper: Address,
        tips: Vec<HighlightTipInput>,
    ) -> BatchTipReceipt {
        pausable::when_not_paused(&env);
        tipper.require_auth();

        if tips.len() == 0 {
            panic!("Batch tip input cannot be empty");
        }

        let mut index = 0;
        while index < tips.len() {
            let tip = tips.get(index).unwrap();
            validate_minimum_tip(tip.amount);
            index += 1;
        }

        let platform_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::PlatformAddress)
            .expect("Platform address not set");

        let platform_fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PlatformFeeBps)
            .unwrap_or(DEFAULT_PLATFORM_FEE_BPS);

        let token_address = get_token_address(&env);
        let token_client = token::TokenClient::new(&env, &token_address);

        let mut receipts: Vec<TipReceipt> = vec![&env];
        let mut total_amount = 0i128;
        let mut total_author_received = 0i128;
        let mut total_platform_fee = 0i128;

        index = 0;
        while index < tips.len() {
            let tip = tips.get(index).unwrap();
            let (author_share, platform_fee) = calculate_tip_split(tip.amount, platform_fee_bps);

            token_client.transfer(&tipper, &tip.author, &author_share);

            if platform_fee > 0 {
                token_client.transfer(&tipper, &platform_address, &platform_fee);
            }

            let tip_counter: u64 = env
                .storage()
                .persistent()
                .get(&DataKey::TipCounter)
                .unwrap_or(0);

            let new_tip_id = tip_counter + 1;
            env.storage()
                .persistent()
                .set(&DataKey::TipCounter, &new_tip_id);

            let timestamp = env.ledger().timestamp();
            let stored_tip = HighlightTip {
                highlight_id: tip.highlight_id.clone(),
                article_id: tip.article_id.clone(),
                tipper: tipper.clone(),
                amount: tip.amount,
                timestamp,
            };

            let mut highlight_tips: Vec<HighlightTip> = env
                .storage()
                .persistent()
                .get(&DataKey::HighlightTips(tip.highlight_id.clone()))
                .unwrap_or(vec![&env]);

            highlight_tips.push_back(stored_tip);

            env.storage().persistent().set(
                &DataKey::HighlightTips(tip.highlight_id.clone()),
                &highlight_tips,
            );

            let total_volume: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::TotalVolume)
                .unwrap_or(0);

            env.storage()
                .persistent()
                .set(&DataKey::TotalVolume, &(total_volume + tip.amount));

            let receipt = TipReceipt {
                tip_id: new_tip_id,
                amount_sent: tip.amount,
                author_received: author_share,
                platform_fee,
                timestamp,
            };

            receipts.push_back(receipt);

            BatchHighlightTipEvent {
                data: (
                    tipper.clone(),
                    tip.highlight_id,
                    tip.article_id,
                    tip.author,
                    tip.amount,
                    author_share,
                    platform_fee,
                    new_tip_id,
                ),
            }
            .publish(&env);

            total_amount += tip.amount;
            total_author_received += author_share;
            total_platform_fee += platform_fee;
            index += 1;
        }

        BatchTipReceipt {
            receipts,
            total_amount,
            total_author_received,
            total_platform_fee,
        }
    }

    /// Get all tips for a highlight
    pub fn get_highlight_tips(env: Env, highlight_id: String) -> Vec<HighlightTip> {
        env.storage()
            .persistent()
            .get(&DataKey::HighlightTips(highlight_id))
            .unwrap_or(vec![&env])
    }

    // ========== PAUSABLE PATTERN (OZ) ==========

    /// Check if contract is paused
    pub fn is_paused(env: Env) -> bool {
        pausable::paused(&env)
    }

    /// Pause the contract (admin only)
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");

        if admin != stored_admin {
            panic!("Unauthorized");
        }

        pausable::pause(&env);
    }

    /// Unpause the contract (admin only)
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");

        if admin != stored_admin {
            panic!("Unauthorized");
        }

        pausable::unpause(&env);
    }

    // ========== ARWEAVE-ENABLED TIPPING ==========

    /// Tip an article with Arweave reference
    pub fn tip_article_with_arweave(
        env: Env,
        tipper: Address,
        article_id: Symbol,
        author: Address,
        amount: i128,
        arweave_tx_id: String,
    ) -> TipReceipt {
        // Check not paused
        pausable::when_not_paused(&env);

        // Execute normal tip
        let receipt = Self::tip_article(
            env.clone(),
            tipper.clone(),
            article_id.clone(),
            author.clone(),
            amount,
        );

        // Emit event with Arweave TX ID
        TipWithArweave {
            article_id,
            data: (tipper, author, amount, arweave_tx_id),
        }
        .publish(&env);

        receipt
    }

    /// Tip a highlight with Arweave reference
    pub fn tip_highlight_with_arweave(
        env: Env,
        tipper: Address,
        highlight_id: String,
        article_id: Symbol,
        author: Address,
        amount: i128,
        arweave_tx_id: String,
    ) -> TipReceipt {
        // Check not paused
        pausable::when_not_paused(&env);

        // Execute normal highlight tip
        let receipt = Self::tip_highlight_direct(
            env.clone(),
            tipper.clone(),
            highlight_id.clone(),
            article_id.clone(),
            author.clone(),
            amount,
        );

        // Emit event with Arweave TX ID
        HighlightTipArweave {
            highlight_id,
            data: (tipper, author, amount, arweave_tx_id),
        }
        .publish(&env);

        receipt
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl, contracttype, symbol_short,
        testutils::{Address as _, Events},
        Env, IntoVal,
    };

    // Testnet native XLM token contract used only by SDK unit tests.
    const TESTNET_XLM_TOKEN_ADDRESS: &str =
        "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

    #[derive(Clone)]
    #[contracttype]
    enum MockTokenKey {
        Balance(Address),
    }

    #[contract]
    struct MockToken;

    #[contractimpl]
    impl MockToken {
        pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
            from.require_auth();

            let from_balance = Self::balance(env.clone(), from.clone());
            env.storage()
                .persistent()
                .set(&MockTokenKey::Balance(from), &(from_balance - amount));

            let to_balance = Self::balance(env.clone(), to.clone());
            env.storage()
                .persistent()
                .set(&MockTokenKey::Balance(to), &(to_balance + amount));
        }

        pub fn balance(env: Env, id: Address) -> i128 {
            env.storage()
                .persistent()
                .get(&MockTokenKey::Balance(id))
                .unwrap_or(0)
        }
    }

    fn register_xlm_token(env: &Env) -> Address {
        let xlm_address = Address::from_string(&String::from_str(env, TESTNET_XLM_TOKEN_ADDRESS));
        env.register_at(&xlm_address, MockToken, ());
        xlm_address
    }

    fn register_mock_token(env: &Env) -> Address {
        let token_address = Address::generate(env);
        env.register_at(&token_address, MockToken, ());
        token_address
    }

    #[test]
    fn test_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = Address::generate(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);

        client.initialize(&admin, &platform, &token_address, &Some(250));

        // Verify initialization
        let volume = client.get_total_volume();
        assert_eq!(volume, 0);
    }

    #[test]
    fn test_tip_article() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_xlm_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);
        let author = Address::generate(&env);

        // Initialize contract
        client.initialize(&admin, &platform, &token_address, &Some(250));

        // Send a tip
        let receipt = client.tip_article(
            &tipper,
            &symbol_short!("article1"),
            &author,
            &1_000_000, // 0.1 XLM
        );

        // Verify receipt
        assert_eq!(receipt.amount_sent, 1_000_000);
        assert_eq!(receipt.platform_fee, 25_000); // 2.5%
        assert_eq!(receipt.author_received, 975_000); // 97.5%

        // Check author balance
        let balance = client.get_balance(&author);
        assert_eq!(balance, 975_000);

        // Check tips for article
        let tips = client.get_article_tips(&symbol_short!("article1"));
        assert_eq!(tips.len(), 1);
    }

    #[test]
    fn test_tip_article_uses_configured_token_address() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_mock_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);
        let author = Address::generate(&env);

        client.initialize(&admin, &platform, &token_address, &Some(250));
        client.tip_article(&tipper, &symbol_short!("article1"), &author, &1_000_000);

        assert_eq!(client.get_balance(&author), 975_000);
        assert_eq!(client.get_balance(&platform), 25_000);
    }

    #[test]
    fn test_tip_article_with_arweave_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_xlm_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);
        let author = Address::generate(&env);
        let article_id = symbol_short!("article1");
        let amount = 1_000_000;
        let arweave_tx_id = String::from_str(&env, "arweave_article_tx");

        client.initialize(&admin, &platform, &token_address, &Some(250));
        client.tip_article_with_arweave(&tipper, &article_id, &author, &amount, &arweave_tx_id);

        let events = env.events().all();
        assert_eq!(events.len(), 1);

        let event = events.get(0).unwrap();
        assert_eq!(event.0, contract_id);
        assert_eq!(
            event.1,
            (Symbol::new(&env, "tip_with_arweave"), article_id.clone(),).into_val(&env)
        );

        let actual_data: (Address, Address, i128, String) = event.2.into_val(&env);
        assert_eq!(actual_data, (tipper, author, amount, arweave_tx_id));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1000)")]
    fn test_paused_tip_article_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_xlm_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);
        let author = Address::generate(&env);

        client.initialize(&admin, &platform, &token_address, &Some(250));
        client.pause(&admin);

        client.tip_article(&tipper, &symbol_short!("article1"), &author, &1_000_000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1000)")]
    fn test_paused_tip_highlight_direct_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_xlm_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);
        let author = Address::generate(&env);
        let highlight_id = String::from_str(&env, "highlight_1");

        client.initialize(&admin, &platform, &token_address, &Some(250));
        client.pause(&admin);

        client.tip_highlight_direct(
            &tipper,
            &highlight_id,
            &symbol_short!("article1"),
            &author,
            &1_000_000,
        );
    }

    #[test]
    fn test_tip_highlight_with_arweave_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_xlm_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);
        let author = Address::generate(&env);
        let highlight_id = String::from_str(&env, "highlight_1");
        let article_id = symbol_short!("article1");
        let amount = 1_000_000;
        let arweave_tx_id = String::from_str(&env, "arweave_highlight_tx");

        client.initialize(&admin, &platform, &token_address, &Some(250));
        client.tip_highlight_with_arweave(
            &tipper,
            &highlight_id,
            &article_id,
            &author,
            &amount,
            &arweave_tx_id,
        );

        let events = env.events().all();
        assert_eq!(events.len(), 1);

        let event = events.get(0).unwrap();
        assert_eq!(event.0, contract_id);
        assert_eq!(
            event.1,
            (
                Symbol::new(&env, "highlight_tip_arweave"),
                highlight_id.clone(),
            )
                .into_val(&env)
        );

        let actual_data: (Address, Address, i128, String) = event.2.into_val(&env);
        assert_eq!(actual_data, (tipper, author, amount, arweave_tx_id));
    }

    #[test]
    fn test_article_total_tips_increments_once_per_tip() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_xlm_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);
        let author = Address::generate(&env);
        let article_id = symbol_short!("article1");

        client.initialize(&admin, &platform, &token_address, &Some(250));
        client.tip_article(&tipper, &article_id, &author, &1_000_000);

        assert_eq!(client.get_article_total_tips(&article_id), 1_000_000);
    }

    #[test]
    #[should_panic(expected = "Amount below minimum tip")]
    fn test_minimum_tip_enforcement() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = Address::generate(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);
        let author = Address::generate(&env);

        client.initialize(&admin, &platform, &token_address, &Some(250));

        // Try to send tip below minimum
        client.tip_article(
            &tipper,
            &symbol_short!("article1"),
            &author,
            &50_000, // Below minimum
        );
    }

    #[test]
    fn test_batch_tip_articles_settles_and_stores_each_tip() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_xlm_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);
        let author_one = Address::generate(&env);
        let author_two = Address::generate(&env);
        let article_one = symbol_short!("art1");
        let article_two = symbol_short!("art2");

        client.initialize(&admin, &platform, &token_address, &Some(250));

        let receipt = client.batch_tip(
            &tipper,
            &vec![
                &env,
                ArticleTipInput {
                    article_id: article_one.clone(),
                    author: author_one.clone(),
                    amount: 1_000_000,
                },
                ArticleTipInput {
                    article_id: article_two.clone(),
                    author: author_two.clone(),
                    amount: 2_000_000,
                },
            ],
        );
        let events = env.events().all();

        assert_eq!(receipt.receipts.len(), 2);
        assert_eq!(receipt.total_amount, 3_000_000);
        assert_eq!(receipt.total_author_received, 2_925_000);
        assert_eq!(receipt.total_platform_fee, 75_000);

        let first_receipt = receipt.receipts.get(0).unwrap();
        assert_eq!(first_receipt.amount_sent, 1_000_000);
        assert_eq!(first_receipt.author_received, 975_000);
        assert_eq!(first_receipt.platform_fee, 25_000);

        let second_receipt = receipt.receipts.get(1).unwrap();
        assert_eq!(second_receipt.amount_sent, 2_000_000);
        assert_eq!(second_receipt.author_received, 1_950_000);
        assert_eq!(second_receipt.platform_fee, 50_000);

        assert_eq!(client.get_balance(&author_one), 975_000);
        assert_eq!(client.get_balance(&author_two), 1_950_000);
        assert_eq!(client.get_balance(&platform), 75_000);

        let article_one_tips = client.get_article_tips(&article_one);
        assert_eq!(article_one_tips.len(), 1);
        assert_eq!(article_one_tips.get(0).unwrap().amount, 1_000_000);

        let article_two_tips = client.get_article_tips(&article_two);
        assert_eq!(article_two_tips.len(), 1);
        assert_eq!(article_two_tips.get(0).unwrap().amount, 2_000_000);

        assert_eq!(client.get_article_total_tips(&article_one), 1_000_000);
        assert_eq!(client.get_article_total_tips(&article_two), 2_000_000);
        assert_eq!(client.get_total_volume(), 3_000_000);

        assert_eq!(events.len(), 2);

        let event = events.get(0).unwrap();
        assert_eq!(event.0, contract_id);
        assert_eq!(event.1, (Symbol::new(&env, "batch_tip"),).into_val(&env));

        let (
            event_tipper,
            event_article_id,
            event_author,
            event_amount,
            event_author_received,
            event_platform_fee,
            event_tip_id,
        ): (Address, Symbol, Address, i128, i128, i128, u64) = event.2.into_val(&env);
        assert_eq!(event_tipper, tipper);
        assert_eq!(event_article_id, article_one);
        assert_eq!(event_author, author_one);
        assert_eq!(event_amount, 1_000_000);
        assert_eq!(event_author_received, 975_000);
        assert_eq!(event_platform_fee, 25_000);
        assert_eq!(event_tip_id, 1);

        let event = events.get(1).unwrap();
        assert_eq!(event.0, contract_id);
        assert_eq!(event.1, (Symbol::new(&env, "batch_tip"),).into_val(&env));

        let (
            event_tipper,
            event_article_id,
            event_author,
            event_amount,
            event_author_received,
            event_platform_fee,
            event_tip_id,
        ): (Address, Symbol, Address, i128, i128, i128, u64) = event.2.into_val(&env);
        assert_eq!(event_tipper, tipper);
        assert_eq!(event_article_id, article_two);
        assert_eq!(event_author, author_two);
        assert_eq!(event_amount, 2_000_000);
        assert_eq!(event_author_received, 1_950_000);
        assert_eq!(event_platform_fee, 50_000);
        assert_eq!(event_tip_id, 2);
    }

    #[test]
    fn test_batch_tip_highlights_settles_and_stores_each_tip() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_xlm_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);
        let author_one = Address::generate(&env);
        let author_two = Address::generate(&env);
        let highlight_one = String::from_str(&env, "highlight_1");
        let highlight_two = String::from_str(&env, "highlight_2");
        let article_id = symbol_short!("article1");

        client.initialize(&admin, &platform, &token_address, &Some(250));

        let receipt = client.batch_tip_highlights(
            &tipper,
            &vec![
                &env,
                HighlightTipInput {
                    highlight_id: highlight_one.clone(),
                    article_id: article_id.clone(),
                    author: author_one.clone(),
                    amount: 1_000_000,
                },
                HighlightTipInput {
                    highlight_id: highlight_two.clone(),
                    article_id: article_id.clone(),
                    author: author_two.clone(),
                    amount: 2_000_000,
                },
            ],
        );
        let events = env.events().all();

        assert_eq!(receipt.receipts.len(), 2);
        assert_eq!(receipt.total_amount, 3_000_000);
        assert_eq!(receipt.total_author_received, 2_925_000);
        assert_eq!(receipt.total_platform_fee, 75_000);

        assert_eq!(client.get_balance(&author_one), 975_000);
        assert_eq!(client.get_balance(&author_two), 1_950_000);
        assert_eq!(client.get_balance(&platform), 75_000);
        assert_eq!(client.get_total_volume(), 3_000_000);

        let highlight_one_tips = client.get_highlight_tips(&highlight_one);
        assert_eq!(highlight_one_tips.len(), 1);
        assert_eq!(
            highlight_one_tips.get(0).unwrap().highlight_id,
            highlight_one
        );
        assert_eq!(highlight_one_tips.get(0).unwrap().article_id, article_id);
        assert_eq!(highlight_one_tips.get(0).unwrap().amount, 1_000_000);

        let highlight_two_tips = client.get_highlight_tips(&highlight_two);
        assert_eq!(highlight_two_tips.len(), 1);
        assert_eq!(
            highlight_two_tips.get(0).unwrap().highlight_id,
            highlight_two
        );
        assert_eq!(highlight_two_tips.get(0).unwrap().article_id, article_id);
        assert_eq!(highlight_two_tips.get(0).unwrap().amount, 2_000_000);

        assert_eq!(events.len(), 2);

        let event = events.get(0).unwrap();
        assert_eq!(event.0, contract_id);
        assert_eq!(
            event.1,
            (Symbol::new(&env, "batch_tip_highlights"),).into_val(&env)
        );

        let (
            event_tipper,
            event_highlight_id,
            event_article_id,
            event_author,
            event_amount,
            event_author_received,
            event_platform_fee,
            event_tip_id,
        ): (Address, String, Symbol, Address, i128, i128, i128, u64) = event.2.into_val(&env);
        assert_eq!(event_tipper, tipper);
        assert_eq!(event_highlight_id, highlight_one);
        assert_eq!(event_article_id, article_id);
        assert_eq!(event_author, author_one);
        assert_eq!(event_amount, 1_000_000);
        assert_eq!(event_author_received, 975_000);
        assert_eq!(event_platform_fee, 25_000);
        assert_eq!(event_tip_id, 1);

        let event = events.get(1).unwrap();
        assert_eq!(event.0, contract_id);
        assert_eq!(
            event.1,
            (Symbol::new(&env, "batch_tip_highlights"),).into_val(&env)
        );

        let (
            event_tipper,
            event_highlight_id,
            event_article_id,
            event_author,
            event_amount,
            event_author_received,
            event_platform_fee,
            event_tip_id,
        ): (Address, String, Symbol, Address, i128, i128, i128, u64) = event.2.into_val(&env);
        assert_eq!(event_tipper, tipper);
        assert_eq!(event_highlight_id, highlight_two);
        assert_eq!(event_article_id, article_id);
        assert_eq!(event_author, author_two);
        assert_eq!(event_amount, 2_000_000);
        assert_eq!(event_author_received, 1_950_000);
        assert_eq!(event_platform_fee, 50_000);
        assert_eq!(event_tip_id, 2);
    }

    #[test]
    #[should_panic(expected = "Amount below minimum tip")]
    fn test_batch_tip_rejects_any_tip_below_minimum() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_xlm_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);
        let author = Address::generate(&env);

        client.initialize(&admin, &platform, &token_address, &Some(250));

        client.batch_tip(
            &tipper,
            &vec![
                &env,
                ArticleTipInput {
                    article_id: symbol_short!("art1"),
                    author: author.clone(),
                    amount: 1_000_000,
                },
                ArticleTipInput {
                    article_id: symbol_short!("art2"),
                    author,
                    amount: 50_000,
                },
            ],
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1000)")]
    fn test_paused_batch_tip_articles_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_xlm_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);
        let author = Address::generate(&env);

        client.initialize(&admin, &platform, &token_address, &Some(250));
        client.pause(&admin);

        client.batch_tip(
            &tipper,
            &vec![
                &env,
                ArticleTipInput {
                    article_id: symbol_short!("article1"),
                    author,
                    amount: 1_000_000,
                },
            ],
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1000)")]
    fn test_paused_batch_tip_highlights_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_xlm_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);
        let author = Address::generate(&env);

        client.initialize(&admin, &platform, &token_address, &Some(250));
        client.pause(&admin);

        client.batch_tip_highlights(
            &tipper,
            &vec![
                &env,
                HighlightTipInput {
                    highlight_id: String::from_str(&env, "highlight_1"),
                    article_id: symbol_short!("article1"),
                    author,
                    amount: 1_000_000,
                },
            ],
        );
    }

    #[test]
    #[should_panic(expected = "Batch tip input cannot be empty")]
    fn test_empty_batch_tip_articles_fails_clearly() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_xlm_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);

        client.initialize(&admin, &platform, &token_address, &Some(250));

        client.batch_tip(&tipper, &vec![&env]);
    }

    #[test]
    #[should_panic(expected = "Batch tip input cannot be empty")]
    fn test_empty_batch_tip_highlights_fails_clearly() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_xlm_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);

        client.initialize(&admin, &platform, &token_address, &Some(250));

        client.batch_tip_highlights(&tipper, &vec![&env]);
    }

    #[test]
    fn test_tip_with_immediate_transfers() {
        let env = Env::default();
        env.mock_all_auths();
        let token_address = register_xlm_token(&env);

        let contract_id = env.register(TippingContract, ());
        let client = TippingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let platform = Address::generate(&env);
        let tipper = Address::generate(&env);
        let author = Address::generate(&env);

        client.initialize(&admin, &platform, &token_address, &Some(250));

        // Send tips
        client.tip_article(&tipper, &symbol_short!("art1"), &author, &1_000_000);
        client.tip_article(&tipper, &symbol_short!("art2"), &author, &2_000_000);

        // Note: With mock_all_auths(), token transfers are simulated
        // On testnet, the XLM token contract is pre-deployed by Stellar
        // and these would be real XLM transfers

        // Check article total tips (for NFT threshold tracking)
        let art1_total = client.get_article_total_tips(&symbol_short!("art1"));
        assert_eq!(art1_total, 1_000_000);

        let art2_total = client.get_article_total_tips(&symbol_short!("art2"));
        assert_eq!(art2_total, 2_000_000);
    }
}
