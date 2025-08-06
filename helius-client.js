require('dotenv').config();
const axios = require('axios');

class HeliusClient {
  constructor() {
    this.apiKey = process.env.HELIUS_API_KEY;
    if (!this.apiKey) {
      throw new Error('❌ HELIUS_API_KEY is missing. Please set it in your environment.');
    }

    this.baseURL = 'https://api.helius.xyz/v1';
    this.primaryRPC = 'https://api.mainnet-beta.solana.com'; // Solana default
    this.fallbackRPC = `https://mainnet.helius.rpcpool.com/?api-key=${this.apiKey}`; // Helius fallback

    this.lastRequestTime = 0;
    this.rateLimitDelay = parseInt(process.env.RATE_LIMIT_DELAY) || 5000;

    console.log('🧠 [HeliusClient] Initialized');
    console.log(`🔑 API Key loaded: ${this.apiKey?.slice(0, 6)}...`);
    console.log('🔗 Primary RPC:', this.primaryRPC);
    console.log('🔗 Fallback RPC:', this.fallbackRPC);
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

  async postRPC(url, payload) {
    try {
      return await axios.post(url, payload);
    } catch (error) {
      console.warn(`⚠️ RPC Failed: ${error.message}`);
      return null;
    }
  }

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

    console.log(`🔍 [Solana RPC] Attempting primary RPC`);
    let response = await this.postRPC(this.primaryRPC, payload);

    if (!response || !response.data.result) {
      console.log(`🔁 [Fallback] Trying Helius RPC`);
      response = await this.postRPC(this.fallbackRPC, payload);
    }

    const accounts = response?.data?.result?.value || [];
    console.log(`✅ Found ${accounts.length} token accounts`);
    return accounts;
  }

  async getTransactions(address, beforeSignature = null, limit = 10) {
    console.log(`📡 [getTransactions] Fetching txs for ${address}`);
    await this.waitForRateLimit();

    const getEndpoint = `${this.baseURL}/addresses/${address}/transactions`;
    const getParams = {
      'api-key': this.apiKey,
      limit,
    };
    if (beforeSignature) getParams.before = beforeSignature;

    try {
      const response = await axios.get(getEndpoint, { params: getParams });
      console.log(`✅ [GET] Retrieved ${response.data.length} txs`);
      return response.data;
    } catch (getError) {
      console.warn(`⚠️ [GET] Failed: ${getError.message}`);
      console.log(`🔁 Trying fallback POST...`);

      const postEndpoint = `${this.baseURL}/transactions?api-key=${this.apiKey}`;
      const postPayload = { accounts: [address], limit };
      if (beforeSignature) postPayload.before = beforeSignature;

      try {
        const postResponse = await axios.post(postEndpoint, postPayload, {
          headers: { 'Content-Type': 'application/json' }
        });
        console.log(`✅ [POST] Retrieved ${postResponse.data.length} txs`);
        return postResponse.data;
      } catch (postError) {
        console.error(`❌ [POST] Failed: ${postError.message}`);
        return [];
      }
    }
  }

  async getTokenMetadata(tokenAddress) {
    await this.waitForRateLimit();
    const url = `${this.baseURL}/tokens/metadata`;
    const params = { addresses: [tokenAddress], 'api-key': this.apiKey };

    try {
      const response = await axios.get(url, { params });
      const metadata = response.data[0] || null;
      if (metadata) console.log(`✅ Symbol=${metadata.symbol}`);
      else console.log(`⚠️ No metadata found`);
      return metadata;
    } catch (error) {
      console.error(`❌ [getTokenMetadata] Error: ${error.message}`);
      return null;
    }
  }

  async getTokenPrice(tokenAddress) {
    await this.waitForRateLimit();
    const url = `https://price.jup.ag/v4/price?ids=${tokenAddress}`;
    try {
      const response = await axios.get(url);
      const priceData = response.data.data[tokenAddress] || null;
      if (priceData) console.log(`💰 Price: $${priceData.price}`);
      else console.log(`⚠️ No price data`);
      return priceData;
    } catch (error) {
      console.error(`❌ [getTokenPrice] Error: ${error.message}`);
      return null;
    }
  }

  parseSwapTransaction(transaction) {
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
    for (const instruction of instructions) {
      const program = instruction.programId;
      const accounts = instruction.accounts || [];

      if (program === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4') {
        swapData.protocol = 'Jupiter';
      } else if (program === '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM') {
        swapData.protocol = 'Raydium';
      } else if (program === 'EhpHV7B2r4F4zHF2qNpANKKLNEtCT6Z6LNHNz8Xr8kLJ') {
        swapData.protocol = 'Orca';
      } else {
        continue;
      }

      if (accounts.length >= 4) {
        swapData.tokenIn = accounts[2];
        swapData.tokenOut = accounts[3];
      }
    }

    return swapData.tokenIn && swapData.tokenOut ? swapData : null;
  }

  async getRecentSwaps(walletAddress, limit = 5) {
    const transactions = await this.getTransactions(walletAddress, null, limit * 3);
    const swaps = [];

    for (const tx of transactions) {
      const swapData = this.parseSwapTransaction(tx);
      if (swapData) swaps.push(swapData);
      if (swaps.length >= limit) break;
    }

    console.log(`✅ Found ${swaps.length} swap(s)`);
    return swaps;
  }
}

module.exports = HeliusClient;
