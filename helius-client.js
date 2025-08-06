require('dotenv').config();
const axios = require('axios');

class HeliusClient {
  constructor() {
    this.apiKey = process.env.HELIUS_API_KEY;
    if (!this.apiKey) {
      throw new Error('❌ HELIUS_API_KEY is missing. Please set it in your environment.');
    }
    this.baseURL = 'https://api.helius.xyz/v1';
    this.rpcURL = `https://mainnet.helius.rpcpool.com/?api-key=${this.apiKey}`;
    this.lastRequestTime = 0;
    this.rateLimitDelay = parseInt(process.env.RATE_LIMIT_DELAY) || 1000;

    console.log('🧠 [HeliusClient] Initialized');
    console.log(`🔑 API Key loaded: ${this.apiKey?.slice(0, 6)}...`);
    console.log('🔗 baseURL:', this.baseURL);
    console.log('🔗 rpcURL:', this.rpcURL);
  }

  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.rateLimitDelay) {
      const waitTime = this.rateLimitDelay - timeSinceLastRequest;
      console.log(`⏳ [RateLimit] Waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * ✅ FIXED: Uses current /addresses/{address}/transactions GET endpoint
   * 🧠 Includes fallback POST if GET fails
   */
  async getTransactions(address, beforeSignature = null, limit = 10) {
    console.log(`📡 [getTransactions] Fetching txs for ${address}`);
    await this.waitForRateLimit();

    const getEndpoint = `${this.baseURL}/addresses/${address}/transactions`;
    const getParams = {
      'api-key': this.apiKey,
      limit,
    };
    if (beforeSignature) {
      getParams.before = beforeSignature;
    }

    try {
      console.log(`🔍 [GET] ${getEndpoint}`);
      console.log(`📦 Params:`, JSON.stringify(getParams, null, 2));
      const response = await axios.get(getEndpoint, { params: getParams });
      console.log(`✅ [GET] Retrieved ${response.data.length} txs`);
      return response.data;
    } catch (getError) {
      console.warn(`⚠️ [GET] Failed: ${getError.response?.data?.error?.message || getError.message}`);
      console.log(`🔁 Trying fallback POST...`);

      const postEndpoint = `${this.baseURL}/transactions?api-key=${this.apiKey}`;
      const postPayload = {
        accounts: [address],
        limit,
      };
      if (beforeSignature) {
        postPayload.before = beforeSignature;
      }

      try {
        console.log(`🔍 [POST] ${postEndpoint}`);
        console.log(`📦 Payload:`, JSON.stringify(postPayload, null, 2));
        const postResponse = await axios.post(postEndpoint, postPayload, {
          headers: { 'Content-Type': 'application/json' },
        });
        console.log(`✅ [POST] Retrieved ${postResponse.data.length} txs`);
        return postResponse.data;
      } catch (postError) {
        console.error(`❌ [POST] Failed: ${postError.response?.data?.error?.message || postError.message}`);
        return [];
      }
    }
  }

  // 🔄 Everything below remains unchanged
  async getTokenAccounts(address) {
    console.log(`📡 [getTokenAccounts] Fetching for ${address}`);
    await this.waitForRateLimit();

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [
        address,
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { encoding: 'jsonParsed' }
      ]
    };

    console.log(`🔍 [getTokenAccounts] POST to: ${this.rpcURL}`);
    console.log(`📦 Payload:`, JSON.stringify(payload, null, 2));

    try {
      const response = await axios.post(this.rpcURL, payload);
      const accounts = response.data.result?.value || [];
      console.log(`✅ Found ${accounts.length} token accounts`);
      return accounts;
    } catch (error) {
      console.error(`❌ [getTokenAccounts] Error:`, error.response?.data || error.message);
      throw error;
    }
  }

  async getTokenMetadata(tokenAddress) {
    console.log(`📡 [getTokenMetadata] Fetching for ${tokenAddress}`);
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
        console.log(`✅ Symbol=${metadata.symbol}`);
      } else {
        console.log(`⚠️ No metadata found`);
      }
      return metadata;
    } catch (error) {
      console.error(`❌ [getTokenMetadata] Error:`, error.response?.data || error.message);
      return null;
    }
  }

  async getTokenPrice(tokenAddress) {
    console.log(`📡 [getTokenPrice] Fetching for ${tokenAddress}`);
    await this.waitForRateLimit();

    try {
      const response = await axios.get(`https://price.jup.ag/v4/price?ids=${tokenAddress}`);
      const priceData = response.data.data[tokenAddress] || null;

      if (priceData) {
        console.log(`💰 Price: $${priceData.price}`);
      } else {
        console.log(`⚠️ No price data`);
      }

      return priceData;
    } catch (error) {
      console.error(`❌ [getTokenPrice] Error:`, error.response?.data || error.message);
      return null;
    }
  }

  parseSwapTransaction(transaction) {
    console.log(`🔍 [parseSwapTransaction] Parsing ${transaction.signature}`);
    try {
      const swapData = {
        signature: transaction.signature,
        protocol: null,
        tokenIn: null,
        tokenOut: null,
        amountIn: 0,
        amountOut: 0,
        timestamp: transaction.timestamp
      };

      const instructions = transaction.instructions || [];
      console.log(`ℹ️ Instructions: ${instructions.length}`);

      for (const instruction of instructions) {
        const program = instruction.programId;
        console.log('📦 Instruction:', JSON.stringify(instruction, null, 2));

        const accounts = instruction.accounts || [];
        console.log(`🔎 Program ${program} | Accounts: ${accounts.length}`);

        if (program === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4') {
          swapData.protocol = 'Jupiter';
        } else if (program === '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM') {
          swapData.protocol = 'Raydium';
        } else if (program === 'EhpHV7B2r4F4zHF2qNpANKKLNEtCT6Z6LNHNz8Xr8kLJ') {
          swapData.protocol = 'Orca';
        } else {
          continue;
        }

        console.log(`🔁 Swap via ${swapData.protocol}`);

        if (accounts.length >= 4) {
          swapData.tokenIn = accounts[2];
          swapData.tokenOut = accounts[3];
          console.log(`✅ tokenIn=${accounts[2]}, tokenOut=${accounts[3]}`);
        }
      }

      if (swapData.tokenIn && swapData.tokenOut) {
        return swapData;
      } else {
        console.log(`⚠️ Incomplete swap`);
        return null;
      }

    } catch (error) {
      console.error(`❌ [parseSwapTransaction] Error:`, error.message);
      return null;
    }
  }

  async getRecentSwaps(walletAddress, limit = 5) {
    console.log(`📡 [getRecentSwaps] For ${walletAddress}`);
    try {
      const transactions = await this.getTransactions(walletAddress, null, limit * 3);
      const swaps = [];

      for (const tx of transactions) {
        const swapData = this.parseSwapTransaction(tx);
        if (swapData) {
          swaps.push(swapData);
          console.log(`🔄 Swap: ${swapData.signature}`);
        }

        if (swaps.length >= limit) break;
      }

      console.log(`✅ Found ${swaps.length} swap(s)`);
      return swaps;
    } catch (error) {
      console.error(`❌ [getRecentSwaps] Error:`, error.response?.data || error.message);
      return [];
    }
  }
}

module.exports = HeliusClient;
