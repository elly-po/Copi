const { Connection } = require('@solana/web3.js');
const axios = require('axios');
const Database = require('./database');
const EventEmitter = require('events');

class TradingEngine extends EventEmitter {
  constructor() {
    super();
    console.log('[Init] Creating new TradingEngine instance');
    this.connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, 'confirmed');
    console.log('[Init] Solana connection established');
    this.db = Database;
    this.activeUsers = new Map();
  }

  async initialize() {
    console.log('[Init] Trading engine initialization completed');
  }

  async addUser(telegramId, walletAddress) {
    console.log(`[User] Adding user ${telegramId} with wallet ${walletAddress}`);
    try {
      const settings = await this.db.getUserSettings(telegramId);
      this.activeUsers.set(telegramId, {
        walletAddress,
        settings,
        lastTradeTime: 0,
        tradesThisHour: 0,
        hourlyReset: Date.now() + 3600000
      });
      return true;
    } catch (error) {
      console.error(`[User] Error adding user ${telegramId}:`, error.message);
      return false;
    }
  }

  async removeUser(telegramId) {
    this.activeUsers.delete(telegramId);
    console.log(`[User] Removed ${telegramId}`);
  }

  async handleTradeSignal(tradeSignal) {
    if (!this.activeUsers.size) return;

    for (const [telegramId, userData] of this.activeUsers) {
      if (!userData.settings.auto_trading) continue;
      if (!this.canUserTrade(telegramId, userData)) continue;

      try {
        await this.executeTrade({ telegramId, userData, tradeSignal });
      } catch (err) {
        console.error(`[Exec] Error for ${telegramId}:`, err.message);
      }
    }
  }

  canUserTrade(telegramId, userData) {
    const now = Date.now();

    if (now > userData.hourlyReset) {
      userData.tradesThisHour = 0;
      userData.hourlyReset = now + 3600000;
    }

    if (userData.tradesThisHour >= userData.settings.max_trades_per_hour) return false;
    if (now - userData.lastTradeTime < 30000) return false;

    return true;
  }

  async executeTrade({ telegramId, userData, tradeSignal }) {
    const tradeAmount = Math.min(
      userData.settings.max_trade_amount,
      (tradeSignal.amountIn || 0) * 0.1
    );

    const quote = await this.getJupiterQuote(
      'So11111111111111111111111111111111111111112',
      tradeSignal.tokenAddress,
      tradeAmount * 1e9
    );

    if (!quote) return;

    const simulatedTx = await this.simulateTrade(quote, userData.walletAddress);
    if (!simulatedTx.success) return;

    const tradeRecord = {
      telegramId,
      alphaWallet: tradeSignal.alphaWallet,
      tokenAddress: tradeSignal.tokenAddress,
      tradeType: 'BUY',
      amount: tradeAmount,
      price: quote.outAmount / quote.inAmount,
      signature: simulatedTx.signature,
      status: 'completed'
    };

    await this.db.saveTrade(tradeRecord);
    userData.lastTradeTime = Date.now();
    userData.tradesThisHour++;

    this.emit('tradeCompleted', {
      telegramId,
      tradeRecord,
      tokenSymbol: tradeSignal.tokenSymbol,
      tokenName: tradeSignal.tokenName
    });
  }

  async getJupiterQuote(inputMint, outputMint, amount) {
    try {
      const response = await axios.get('https://quote-api.jup.ag/v6/quote', {
        params: { inputMint, outputMint, amount, slippageBps: 500 }
      });
      return response.data;
    } catch (error) {
      console.error('[Quote] Error:', error.message);
      return null;
    }
  }

  async simulateTrade(quote, walletAddress) {
    try {
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
      const success = Math.random() > 0.1;
      return {
        success,
        signature: success ? this.generateMockSignature() : null,
        error: success ? null : 'Simulation failed'
      };
    } catch (error) {
      return { success: false, signature: null, error: error.message };
    }
  }

  generateMockSignature() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let signature = '';
    for (let i = 0; i < 88; i++) {
      signature += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return signature;
  }

  async updateUserSettings(telegramId) {
    if (this.activeUsers.has(telegramId)) {
      const settings = await this.db.getUserSettings(telegramId);
      this.activeUsers.get(telegramId).settings = settings;
    }
  }

  getActiveUsers() {
    return Array.from(this.activeUsers.keys());
  }

  getUserStats(telegramId) {
    const userData = this.activeUsers.get(telegramId);
    if (!userData) return null;

    return {
      tradesThisHour: userData.tradesThisHour,
      maxTradesPerHour: userData.settings.max_trades_per_hour,
      lastTradeTime: userData.lastTradeTime,
      autoTrading: userData.settings.auto_trading
    };
  }
}

module.exports = TradingEngine;