const { Connection, PublicKey, Transaction, SystemProgram } = require('@solana/web3.js');
const axios = require('axios');
const Database = require('./database');
const EventEmitter = require('events');

class TradingEngine extends EventEmitter {
  constructor() {
    super();
    console.log('[Init] Creating new TradingEngine instance');
    this.connection = new Connection(
      `${process.env.HELIUS_RPC_URL}${process.env.HELIUS_API_KEY}`,
      'confirmed'
    );
    console.log('[Init] Solana connection established');
    this.db = Database;
    this.activeUsers = new Map();
    this.tradeQueue = [];
    this.processing = false;
  }

  async initialize() {
    console.log('[Init] Trading engine initialization started');
    this.processTradeQueue();
    console.log('[Init] Trading engine initialization completed');
  }

  async addUser(telegramId, walletAddress) {
    console.log(`[User] Adding user ${telegramId} with wallet ${walletAddress}`);
    try {
      const settings = await this.db.getUserSettings(telegramId);
      console.log(`[User] Retrieved settings for ${telegramId}:`, settings);

      this.activeUsers.set(telegramId, {
        walletAddress,
        settings,
        lastTradeTime: 0,
        tradesThisHour: 0,
        hourlyReset: Date.now() + 3600000
      });

      console.log(`[User] User ${telegramId} added to activeUsers`);
      return true;
    } catch (error) {
      console.error(`[User] Error adding user ${telegramId}:`, error.message);
      return false;
    }
  }

  async removeUser(telegramId) {
    console.log(`[User] Removing user ${telegramId}`);
    this.activeUsers.delete(telegramId);
    console.log(`[User] User ${telegramId} removed`);
  }

  async handleTradeSignal(tradeSignal) {
    console.log('[Signal] Handling trade signal:', tradeSignal);

    if (!this.activeUsers.size) {
      console.log('[Signal] No active users to process');
      return;
    }

    console.log('[Signal] Active users count:', this.activeUsers.size);

    for (const [telegramId, userData] of this.activeUsers) {
      console.log(`[Signal] Evaluating user ${telegramId}`);

      if (!userData.settings.auto_trading) {
        console.log(`[Signal] User ${telegramId} has auto trading disabled`);
        continue;
      }

      if (!this.canUserTrade(telegramId, userData)) {
        console.log(`[Signal] User ${telegramId} is not eligible to trade`);
        continue;
      }

      this.tradeQueue.push({
        telegramId,
        userData,
        tradeSignal,
        timestamp: Date.now()
      });

      console.log(`[Signal] Trade signal added to queue for user ${telegramId}`);
    }

    console.log('[Signal] Trade queue length:', this.tradeQueue.length);
  }

  canUserTrade(telegramId, userData) {
    const now = Date.now();
    console.log(`[RateLimit] Checking if user ${telegramId} can trade`);

    if (now > userData.hourlyReset) {
      console.log(`[RateLimit] Resetting hourly counter for user ${telegramId}`);
      userData.tradesThisHour = 0;
      userData.hourlyReset = now + 3600000;
    }

    if (userData.tradesThisHour >= userData.settings.max_trades_per_hour) {
      console.log(`[RateLimit] User ${telegramId} reached max trades per hour`);
      return false;
    }

    if (now - userData.lastTradeTime < 30000) {
      console.log(`[RateLimit] User ${telegramId} is trading too frequently`);
      return false;
    }

    console.log(`[RateLimit] User ${telegramId} is eligible to trade`);
    return true;
  }

  async processTradeQueue() {
    console.log('[Queue] Starting trade queue processing');

    if (this.processing || this.tradeQueue.length === 0) {
      console.log(`[Queue] Skipping processing — active: ${this.processing}, queue length: ${this.tradeQueue.length}`);
      setTimeout(() => this.processTradeQueue(), 1000);
      return;
    }

    this.processing = true;
    console.log('[Queue] Processing a trade');

    try {
      const trade = this.tradeQueue.shift();
      console.log('[Queue] Trade popped:', trade);

      if (trade) {
        await this.executeTrade(trade);
      }
    } catch (error) {
      console.error('[Queue] Error while executing trade:', error.message);
    }

    this.processing = false;
    console.log('[Queue] Trade processing completed');
    setTimeout(() => this.processTradeQueue(), 2000);
  }

  async executeTrade(trade) {
    const { telegramId, userData, tradeSignal } = trade;
    console.log(`[Exec] Executing trade for ${telegramId} with signal:`, tradeSignal);

    try {
      const tradeAmount = Math.min(
        userData.settings.max_trade_amount,
        tradeSignal.amountIn * 0.1
      );
      console.log(`[Exec] Trade amount calculated: ${tradeAmount}`);

      const quote = await this.getJupiterQuote(
        'So11111111111111111111111111111111111111112',
        tradeSignal.tokenAddress,
        tradeAmount * 1e9
      );
      console.log('[Exec] Jupiter quote received:', quote);

      if (!quote) {
        console.log('[Exec] Quote retrieval failed');
        return;
      }

      const simulatedTx = await this.simulateTrade(quote, userData.walletAddress);
      console.log('[Exec] Simulated transaction:', simulatedTx);

      if (simulatedTx.success) {
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
        console.log('[Exec] Trade record saved:', tradeRecord);

        userData.lastTradeTime = Date.now();
        userData.tradesThisHour++;

        this.emit('tradeCompleted', {
          telegramId,
          tradeRecord,
          tokenSymbol: tradeSignal.tokenSymbol,
          tokenName: tradeSignal.tokenName
        });

        console.log(`[✅] Trade completed for user ${telegramId}`);
      } else {
        console.log('[Exec] Simulated trade failed');
      }

    } catch (error) {
      console.error(`[Exec] Error for user ${telegramId}:`, error.message);
      this.emit('tradeError', {
        telegramId,
        error: error.message,
        tokenSymbol: tradeSignal.tokenSymbol
      });
    }
  }

  async getJupiterQuote(inputMint, outputMint, amount) {
    console.log('[Quote] Fetching quote for:', { inputMint, outputMint, amount });

    try {
      const response = await axios.get('https://quote-api.jup.ag/v6/quote', {
        params: {
          inputMint,
          outputMint,
          amount,
          slippageBps: 500
        }
      });
      console.log('[Quote] Quote received:', response.data);
      return response.data;
    } catch (error) {
      console.error('[Quote] Error fetching quote:', error.message);
      return null;
    }
  }

  async simulateTrade(quote, walletAddress) {
    console.log('[Sim] Starting trade simulation with quote:', quote);
    console.log('[Sim] Wallet address:', walletAddress);

    try {
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      const success = Math.random() > 0.1;
      const result = {
        success,
        signature: success ? this.generateMockSignature() : null,
        error: success ? null : 'Simulation failed'
      };
      console.log('[Sim] Simulation result:', result);
      return result;
    } catch (error) {
      console.error('[Sim] Simulation error:', error.message);
      return {
        success: false,
        signature: null,
        error: error.message
      };
    }
  }

  generateMockSignature() {
    console.log('[Mock] Generating mock signature');
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let signature = '';
    for (let i = 0; i < 88; i++) {
      signature += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    console.log('[Mock] Signature:', signature);
    return signature;
  }

  async updateUserSettings(telegramId) {
    console.log(`[User] Updating settings for ${telegramId}`);
    if (this.activeUsers.has(telegramId)) {
      const settings = await this.db.getUserSettings(telegramId);
      const userData = this.activeUsers.get(telegramId);
      userData.settings = settings;
      console.log(`[User] Settings updated for ${telegramId}:`, settings);
    } else {
      console.log(`[User] Cannot update settings — user ${telegramId} not found`);
    }
  }

  getActiveUsers() {
    console.log('[Stats] Getting active user list');
    const users = Array.from(this.activeUsers.keys());
    console.log('[Stats] Active users:', users);
    return users;
  }

  getUserStats(telegramId) {
    console.log(`[Stats] Getting stats for user ${telegramId}`);
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
