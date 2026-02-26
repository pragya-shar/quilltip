#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol, vec, Vec};
use stellar_contract_utils::pausable::{self, Pausable, PausableError};
use stellar_access::ownable::{self, Ownable, OwnableError};
use stellar_macros::{only_owner, when_not_paused};

/// Minimal NFT implementation for articles
/// Each article can be minted as a unique NFT once it reaches a tip threshold

#[derive(Clone)]
#[contracttype]
pub struct NFTToken {
    pub token_id: u64,
    pub article_id: Symbol,
    pub owner: Address,
    pub minter: Address,
    pub metadata_url: String,  // Just the article URL for POC
    pub arweave_tx_id: Option<String>,  // Arweave TX ID for permanent content
    pub minted_at: u64,
    pub tip_amount: i128,       // Amount of tips when minted
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    TokenCounter,
    Token(u64),                 // token_id -> NFTToken
    ArticleToken(Symbol),       // article_id -> token_id
    OwnerTokens(Address),       // owner -> Vec<token_id>
    TipThreshold,               // Minimum tips required to mint
    Paused,                     // Emergency pause state (OZ Pausable)
}

const DEFAULT_TIP_THRESHOLD: i128 = 100_000_000; // 10 XLM in stroops (~$1)

#[contract]
pub struct ArticleNFTContract;

#[contractimpl]
impl ArticleNFTContract {
    /// Initialize the contract
    pub fn initialize(env: Env, admin: Address, tip_threshold: Option<i128>) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }
        
        admin.require_auth();
        
        let threshold = tip_threshold.unwrap_or(DEFAULT_TIP_THRESHOLD);
        
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TipThreshold, &threshold);
        env.storage().persistent().set(&DataKey::TokenCounter, &0u64);
    }
    
    /// Mint an article as NFT (only if tip threshold is met)
    pub fn mint_article_nft(
        env: Env,
        author: Address,
        article_id: Symbol,
        tip_amount: i128,
        metadata_url: String,
    ) -> u64 {
        author.require_auth();
        
        // Check if article already minted
        if env.storage().persistent().has(&DataKey::ArticleToken(article_id.clone())) {
            panic!("Article already minted as NFT");
        }
        
        // Check tip threshold
        let threshold: i128 = env.storage()
            .instance()
            .get(&DataKey::TipThreshold)
            .unwrap_or(DEFAULT_TIP_THRESHOLD);
            
        if tip_amount < threshold {
            panic!("Tip amount below threshold for minting");
        }
        
        // Generate token ID
        let token_counter: u64 = env.storage()
            .persistent()
            .get(&DataKey::TokenCounter)
            .unwrap_or(0);
        let token_id = token_counter + 1;
        
        // Create NFT token
        let nft = NFTToken {
            token_id,
            article_id: article_id.clone(),
            owner: author.clone(),
            minter: author.clone(),
            metadata_url,
            arweave_tx_id: None,
            minted_at: env.ledger().timestamp(),
            tip_amount,
        };
        
        // Store NFT
        env.storage().persistent().set(&DataKey::Token(token_id), &nft);
        env.storage().persistent().set(&DataKey::ArticleToken(article_id.clone()), &token_id);
        
        // Update owner's token list
        let mut owner_tokens: Vec<u64> = env.storage()
            .persistent()
            .get(&DataKey::OwnerTokens(author.clone()))
            .unwrap_or(vec![&env]);
        owner_tokens.push_back(token_id);
        env.storage().persistent().set(&DataKey::OwnerTokens(author.clone()), &owner_tokens);
        
        // Update counter
        env.storage().persistent().set(&DataKey::TokenCounter, &token_id);
        
        // Emit event
        env.events().publish(
            (Symbol::new(&env, "mint"), article_id),
            (author, token_id, tip_amount)
        );
        
        token_id
    }
    
    /// Transfer NFT ownership
    pub fn transfer(
        env: Env,
        from: Address,
        to: Address,
        token_id: u64,
    ) {
        from.require_auth();
        
        // Get token
        let mut nft: NFTToken = env.storage()
            .persistent()
            .get(&DataKey::Token(token_id))
            .expect("Token does not exist");
        
        // Verify ownership
        if nft.owner != from {
            panic!("Not the owner of this token");
        }
        
        // Update owner
        nft.owner = to.clone();
        env.storage().persistent().set(&DataKey::Token(token_id), &nft);
        
        // Update from's token list
        let mut from_tokens: Vec<u64> = env.storage()
            .persistent()
            .get(&DataKey::OwnerTokens(from.clone()))
            .unwrap_or(vec![&env]);
        // Find and remove the token
        let mut index_to_remove = None;
        for (i, id) in from_tokens.iter().enumerate() {
            if id == token_id {
                index_to_remove = Some(i as u32);
                break;
            }
        }
        if let Some(idx) = index_to_remove {
            from_tokens.remove(idx);
        }
        env.storage().persistent().set(&DataKey::OwnerTokens(from.clone()), &from_tokens);
        
        // Update to's token list
        let mut to_tokens: Vec<u64> = env.storage()
            .persistent()
            .get(&DataKey::OwnerTokens(to.clone()))
            .unwrap_or(vec![&env]);
        to_tokens.push_back(token_id);
        env.storage().persistent().set(&DataKey::OwnerTokens(to.clone()), &to_tokens);
        
        // Emit event
        env.events().publish(
            (Symbol::new(&env, "transfer"), token_id),
            (from, to, nft.article_id)
        );
    }
    
    /// Get token owner
    pub fn get_owner(env: Env, token_id: u64) -> Address {
        let nft: NFTToken = env.storage()
            .persistent()
            .get(&DataKey::Token(token_id))
            .expect("Token does not exist");
        nft.owner
    }
    
    /// Check if article is already minted
    pub fn is_article_minted(env: Env, article_id: Symbol) -> bool {
        env.storage().persistent().has(&DataKey::ArticleToken(article_id))
    }
    
    /// Get token by article ID
    pub fn get_token_by_article(env: Env, article_id: Symbol) -> Option<NFTToken> {
        if let Some(token_id) = env.storage()
            .persistent()
            .get::<DataKey, u64>(&DataKey::ArticleToken(article_id)) {
            env.storage().persistent().get(&DataKey::Token(token_id))
        } else {
            None
        }
    }
    
    /// Get all tokens owned by address
    pub fn get_owned_tokens(env: Env, owner: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::OwnerTokens(owner))
            .unwrap_or(vec![&env])
    }
    
    /// Get tip threshold for minting
    pub fn get_tip_threshold(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TipThreshold)
            .unwrap_or(DEFAULT_TIP_THRESHOLD)
    }
    
    /// Update tip threshold (admin only)
    pub fn set_tip_threshold(env: Env, admin: Address, new_threshold: i128) {
        admin.require_auth();

        let stored_admin: Address = env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");

        if admin != stored_admin {
            panic!("Only admin can update threshold");
        }

        env.storage().instance().set(&DataKey::TipThreshold, &new_threshold);
    }

    // ========== PAUSABLE PATTERN (OZ) ==========

    /// Check if contract is paused
    pub fn is_paused(env: Env) -> bool {
        pausable::paused(&env)
    }

    /// Pause the contract (admin only)
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();

        let stored_admin: Address = env.storage()
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

        let stored_admin: Address = env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");

        if admin != stored_admin {
            panic!("Unauthorized");
        }

        pausable::unpause(&env);
    }

    // ========== ARWEAVE-ENABLED MINTING ==========

    /// Mint an article as NFT with Arweave reference
    pub fn mint_article_nft_with_arweave(
        env: Env,
        author: Address,
        article_id: Symbol,
        tip_amount: i128,
        metadata_url: String,
        arweave_tx_id: String,
    ) -> u64 {
        // Check not paused
        pausable::when_not_paused(&env);

        author.require_auth();

        // Check if article already minted
        if env.storage().persistent().has(&DataKey::ArticleToken(article_id.clone())) {
            panic!("Article already minted as NFT");
        }

        // Check tip threshold
        let threshold: i128 = env.storage()
            .instance()
            .get(&DataKey::TipThreshold)
            .unwrap_or(DEFAULT_TIP_THRESHOLD);

        if tip_amount < threshold {
            panic!("Tip amount below threshold for minting");
        }

        // Generate token ID
        let token_counter: u64 = env.storage()
            .persistent()
            .get(&DataKey::TokenCounter)
            .unwrap_or(0);
        let token_id = token_counter + 1;

        // Create NFT token with Arweave reference
        let nft = NFTToken {
            token_id,
            article_id: article_id.clone(),
            owner: author.clone(),
            minter: author.clone(),
            metadata_url,
            arweave_tx_id: Some(arweave_tx_id.clone()),
            minted_at: env.ledger().timestamp(),
            tip_amount,
        };

        // Store NFT
        env.storage().persistent().set(&DataKey::Token(token_id), &nft);
        env.storage().persistent().set(&DataKey::ArticleToken(article_id.clone()), &token_id);

        // Update owner's token list
        let mut owner_tokens: Vec<u64> = env.storage()
            .persistent()
            .get(&DataKey::OwnerTokens(author.clone()))
            .unwrap_or(vec![&env]);
        owner_tokens.push_back(token_id);
        env.storage().persistent().set(&DataKey::OwnerTokens(author.clone()), &owner_tokens);

        // Update counter
        env.storage().persistent().set(&DataKey::TokenCounter, &token_id);

        // Emit event with Arweave TX ID
        env.events().publish(
            (Symbol::new(&env, "mint_arweave"), article_id),
            (author, token_id, tip_amount, arweave_tx_id)
        );

        token_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    
    #[test]
    fn test_mint_and_transfer() {
        let env = Env::default();
        let contract_id = env.register(ArticleNFTContract, ());
        let client = ArticleNFTContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let author = Address::generate(&env);
        let buyer = Address::generate(&env);
        
        // Mock auth before any calls that require auth
        env.mock_all_auths();
        
        // Initialize
        client.initialize(&admin, &Some(50_000_000)); // 5 XLM threshold
        
        // Mint NFT
        let article_id = Symbol::new(&env, "article_123");
        let metadata_url = String::from_str(&env, "https://quilltip.me/article/123");
        let token_id = client.mint_article_nft(
            &author,
            &article_id,
            &60_000_000, // 6 XLM (above threshold)
            &metadata_url
        );
        
        assert_eq!(token_id, 1);
        assert_eq!(client.get_owner(&token_id), author);
        assert!(client.is_article_minted(&article_id));
        
        // Transfer NFT
        client.transfer(&author, &buyer, &token_id);
        assert_eq!(client.get_owner(&token_id), buyer);
        
        // Check owned tokens
        let buyer_tokens = client.get_owned_tokens(&buyer);
        assert_eq!(buyer_tokens.len(), 1);
        assert_eq!(buyer_tokens.get(0).unwrap(), token_id);
    }
    
    #[test]
    #[should_panic(expected = "Article already minted as NFT")]
    fn test_double_mint_prevention() {
        let env = Env::default();
        let contract_id = env.register(ArticleNFTContract, ());
        let client = ArticleNFTContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let author = Address::generate(&env);
        
        env.mock_all_auths();
        client.initialize(&admin, &None);
        
        let article_id = Symbol::new(&env, "article_456");
        let metadata_url = String::from_str(&env, "https://quilltip.me/article/456");
        
        // First mint succeeds
        client.mint_article_nft(&author, &article_id, &200_000_000, &metadata_url);
        
        // Second mint should panic
        client.mint_article_nft(&author, &article_id, &300_000_000, &metadata_url);
    }
    
    #[test]
    #[should_panic(expected = "Tip amount below threshold")]
    fn test_threshold_enforcement() {
        let env = Env::default();
        let contract_id = env.register(ArticleNFTContract, ());
        let client = ArticleNFTContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let author = Address::generate(&env);
        
        env.mock_all_auths();
        client.initialize(&admin, &Some(100_000_000)); // 10 XLM threshold
        
        let article_id = Symbol::new(&env, "article_789");
        let metadata_url = String::from_str(&env, "https://quilltip.me/article/789");
        
        // Try to mint with insufficient tips
        client.mint_article_nft(&author, &article_id, &50_000_000, &metadata_url); // Only 5 XLM
    }
}