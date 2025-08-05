const axios = require('axios');

class HeliusClient {
  constructor() {
    this.apiKey = process.env.HELIUS_API_KEY;
    this.baseURL = 'https://api.helius.xyz/v0';
    this.rpcURL = `${process.env.HELIUS_RPC_URL}${this.apiKey}`;
    this.lastRequestTime = 0;
    this.rateLimitDelay = parseInt(process.env.RATE_LIMIT_DELAY) || 1000;
    console.log('🧠 [HeliusClient] Initialized with baseURL:', this.baseURL);
  }

  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.rateLimitDelay) {
      const waitTime = this.rateLimitDelay - timeSinceLastRequest;
      console.log(`⏳ [RateLimit] Waiting ${waitTime}ms to respect rate limit`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  async getTransactions(address, beforeSignature = null, limit = 10) {
    console.log(`📡 [getTransactions] Fetching filtered txs for ${address} | before: ${beforeSignature} | limit: ${limit}`);
    await this.waitForRateLimit();
    
    try {
      const body = {
        address,
        limit,
        before: beforeSignature,
        commitment: 'confirmed',
        transactionTypes: ["SWAP"],// Filter only for swap transactions
      };
      
      const response = await axios.post(
        `${this.baseURL}/addresses/${address}/transactions?api-key=${this.apiKey}`, // API key as URL param
        body, // All filters in POST body
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      
      console.log(`✅ [getTransactions] Retrieved ${response.data.length} filtered txs for ${address}`);
      return response.data;
    } catch (error) {
      console.error(`❌ [getTransactions] Failed to fetch filtered txs for ${address}:`, error.message);
      return [];
    }
  }

  async getTokenAccounts(address) {
    console.log(`📡 [getTokenAccounts] Fetching token accounts for ${address}`);
    await this.waitForRateLimit();

    try {
      const response = await axios.post(this.rpcURL, {
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [
          address,
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          { encoding: 'jsonParsed' }
        ]
      });

      const accounts = response.data.result?.value || [];
      console.log(`✅ [getTokenAccounts] Found ${accounts.length} token accounts for ${address}`);
      return accounts;
    } catch (error) {
      console.error('❌ [getTokenAccounts] Error:', error.message);
      throw error;
    }
  }

  async getTokenMetadata(tokenAddress) {
    console.log(`📡 [getTokenMetadata] Fetching metadata for token: ${tokenAddress}`);
    await this.waitForRateLimit();

    try {
      const response = await axios.get(`${this.baseURL}/tokens/metadata`, {
        params: {
          addresses: [tokenAddress],
          'api-key': this.apiKey
        }
      });

      const metadata = response.data[0] || null;
      if (metadata) {
        console.log(`✅ [getTokenMetadata] Found metadata for ${tokenAddress}: Symbol=${metadata.symbol}`);
      } else {
        console.log(`⚠️ [getTokenMetadata] No metadata found for ${tokenAddress}`);
      }
      return metadata;
    } catch (error) {
      console.error('❌ [getTokenMetadata] Error:', error.message);
      return null;
    }
  }

  async getTokenPrice(tokenAddress) {
    console.log(`📡 [getTokenPrice] Fetching price for ${tokenAddress}`);
    await this.waitForRateLimit();

    try {
      const response = await axios.get(`https://price.jup.ag/v4/price?ids=${tokenAddress}`);
      const priceData = response.data.data[tokenAddress] || null;

      if (priceData) {
        console.log(`💰 [getTokenPrice] Price found: $${priceData.price}`);
      } else {
        console.log(`⚠️ [getTokenPrice] No price data for ${tokenAddress}`);
      }

      return priceData;
    } catch (error) {
      console.error('❌ [getTokenPrice] Error:', error.message);
      return null;
    }
  }

  parseSwapTransaction(transaction) {
    console.log(`🔍 [parseSwapTransaction] Parsing txn: ${transaction.signature}`);
    try {
      const swapData = {
        signature: transaction.signature,
        tokenIn: null,
        tokenOut: null,
        amountIn: 0,
        amountOut: 0,
        timestamp: transaction.timestamp
      };

      const instructions = transaction.instructions || [];
      console.log(`ℹ️ [parseSwapTransaction] Instructions count: ${instructions.length}`);

      for (const instruction of instructions) {
        const program = instruction.programId;

        if (
          program === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' || // Jupiter
          program === '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' || // Raydium
          program === 'EhpHV7B2r4F4zHF2qNpANKKLNEtCT6Z6LNHNz8Xr8kLJ'    // Orca
        ) {
          const accounts = instruction.accounts || [];
          console.log(`🔁 [parseSwapTransaction] Swap detected. Accounts length: ${accounts.length}`);

          if (accounts.length >= 4) {
            swapData.tokenIn = accounts[2];
            swapData.tokenOut = accounts[3];
            console.log(`✅ [parseSwapTransaction] tokenIn=${accounts[2]}, tokenOut=${accounts[3]}`);
          }
        }
      }

      return swapData;
    } catch (error) {
      console.error(`❌ [parseSwapTransaction] Error:`, error.message);
      return null;
    }
  }

  async getRecentSwaps(walletAddress, limit = 5) {
    console.log(`📡 [getRecentSwaps] Getting recent swaps for ${walletAddress}`);
    try {
      const transactions = await this.getTransactions(walletAddress, null, limit);
      const swaps = [];

      for (const tx of transactions) {
        const swapData = this.parseSwapTransaction(tx);
        if (swapData && swapData.tokenIn && swapData.tokenOut) {
          swaps.push(swapData);
          console.log(`🔄 [getRecentSwaps] Swap detected: ${swapData.signature}`);
        }
      }

      console.log(`✅ [getRecentSwaps] Found ${swaps.length} swap(s) for ${walletAddress}`);
      return swaps;
    } catch (error) {
      console.error('❌ [getRecentSwaps] Error:', error.message);
      return [];
    }
  }
}

module.exports = HeliusClient;
