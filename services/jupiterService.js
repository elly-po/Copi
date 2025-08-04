const axios = require('axios');
const config = require('../config/config');
const walletManager = require('../wallet/walletManager');

class JupiterService {
  constructor() {
    this.baseURL = config.jupiter.apiUrl;
    this.swapURL = config.jupiter.swapUrl;
  }

  async getQuote(inputMint, outputMint, amount, slippage) {
    try {
      const response = await axios.get(`${this.baseURL}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount: amount * 1e9, // SOL to lamports
          slippageBps: slippage * 100 // % to basis points
        }
      });
      
      return {
        inputAmount: response.data.inAmount,
        outputAmount: response.data.outAmount,
        route: response.data.route
      };
    } catch (error) {
      console.error('Jupiter quote error:', error.response?.data || error.message);
      throw new Error('Failed to get quote');
    }
  }

  async executeSwap(userId, route, swapConfig) {
    try {
      const user = await database.getUser(userId);
      if (!user?.wallet) throw new Error('User wallet not connected');
      
      const { publicKey, keypair } = walletManager.importWallet(
        walletManager.decryptPrivateKey(user.wallet.encryptedKey, config.security.encryptionKey)
      );

      const swapResponse = await axios.post(`${this.swapURL}`, {
        route,
        userPublicKey: publicKey,
        wrapUnwrapSOL: true
      });

      const swapTransaction = swapResponse.data.swapTransaction;
      const rawTransaction = Buffer.from(swapTransaction, 'base64');
      
      const txid = await walletManager.sendRawTransaction(rawTransaction, keypair);
      return txid;
    } catch (error) {
      console.error('Swap execution error:', error);
      throw error;
    }
  }

  async getTokenList() {
    try {
      const response = await axios.get(`${this.baseURL}/tokens`);
      return response.data;
    } catch (error) {
      console.error('Token list error:', error);
      return [];
    }
  }
}

module.exports = new JupiterService();
