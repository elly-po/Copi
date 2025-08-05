const axios = require('axios');

class HeliusClient {
  constructor() {
    this.apiKey = process.env.HELIUS_API_KEY;
    this.baseURL = 'https://api.helius.xyz/v0';
    this.rpcURL = `${process.env.HELIUS_RPC_URL}${this.apiKey}`;
    this.lastRequestTime = 0;
    this.rateLimitDelay = parseInt(process.env.RATE_LIMIT_DELAY) || 1000;
  }

  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      const waitTime = this.rateLimitDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  async getTransactions(address, beforeSignature = null, limit = 10) {
    await this.waitForRateLimit();
    
    try {
      const params = {
        address,
        limit,
        commitment: 'confirmed'
      };
      
      if (beforeSignature) {
        params.before = beforeSignature;
      }

      const response = await axios.get(`${this.baseURL}/addresses/${address}/transactions`, {
        params: {
          ...params,
          'api-key': this.apiKey
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching transactions:', error.message);
      throw error;
    }
  }

  async getTokenAccounts(address) {
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

      return response.data.result?.value || [];
    } catch (error) {
      console.error('Error fetching token accounts:', error.message);
      throw error;
    }
  }

  async getTokenMetadata(tokenAddress) {
    await this.waitForRateLimit();
    
    try {
      const response = await axios.get(`${this.baseURL}/tokens/metadata`, {
        params: {
          addresses: [tokenAddress],
          'api-key': this.apiKey
        }
      });

      return response.data[0] || null;
    } catch (error) {
      console.error('Error fetching token metadata:', error.message);
      return null;
    }
  }

  async getTokenPrice(tokenAddress) {
    await this.waitForRateLimit();
    
    try {
      // Using Jupiter API for price data (free tier)
      const response = await axios.get(`https://price.jup.ag/v4/price?ids=${tokenAddress}`);
      return response.data.data[tokenAddress] || null;
    } catch (error) {
      console.error('Error fetching token price:', error.message);
      return null;
    }
  }

  parseSwapTransaction(transaction) {
    try {
      // Look for token transfers and swaps in the transaction
      const swapData = {
        signature: transaction.signature,
        tokenIn: null,
        tokenOut: null,
        amountIn: 0,
        amountOut: 0,
        timestamp: transaction.timestamp
      };

      // Parse instruction logs for swap information
      const instructions = transaction.instructions || [];
      
      for (const instruction of instructions) {
        if (instruction.programId === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' || // Jupiter
            instruction.programId === '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' || // Raydium
            instruction.programId === 'EhpHV7B2r4F4zHF2qNpANKKLNEtCT6Z6LNHNz8Xr8kLJ') { // Orca
          
          // Extract swap details from instruction data
          const accounts = instruction.accounts || [];
          if (accounts.length >= 4) {
            swapData.tokenIn = accounts[2];
            swapData.tokenOut = accounts[3];
          }
        }
      }

      return swapData;
    } catch (error) {
      console.error('Error parsing swap transaction:', error.message);
      return null;
    }
  }

  async getRecentSwaps(walletAddress, limit = 5) {
    try {
      const transactions = await this.getTransactions(walletAddress, null, limit);
      const swaps = [];

      for (const tx of transactions) {
        const swapData = this.parseSwapTransaction(tx);
        if (swapData && swapData.tokenIn && swapData.tokenOut) {
          swaps.push(swapData);
        }
      }

      return swaps;
    } catch (error) {
      console.error('Error getting recent swaps:', error.message);
      return [];
    }
  }
}

module.exports = HeliusClient;
