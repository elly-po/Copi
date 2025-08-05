const { Connection, PublicKey, Transaction, SystemProgram } = require('@solana/web3.js');
const axios = require('axios');
const Database = require('./database');
const EventEmitter = require('events');

class TradingEngine extends EventEmitter {
  constructor() {
    super();
    this.connection = new Connection(
      `${process.env.HELIUS_RPC_URL}${process.env.HELIUS_API_KEY}`,
      'confirmed'
    );
    this.db = Database;
    this.activeUsers = new Map();
    this.tradeQueue = [];
    this.processing = false;
  }

  async initialize() {
    console.log('Trading engine initialized');
    this.processTradeQueue();
  }

  async addUser(telegramId, walletAddress) {
    try {
      const settings = await this.db.getUserSettings(telegramId);
      
      this.activeUsers.set(telegramId, {
        walletAddress,
        settings,
        lastTradeTime: 0,
        tradesThisHour: 0,
        hourlyReset: Date.now() + 3600000 // Reset every hour
      });
      
      console.log(`Added user ${telegramId} to trading engine`);
      return true;
    } catch (error) {
      console.error('Error adding user to trading engine:', error.message);
      return false;
    }
  }

  async removeUser(telegramId) {
    this.activeUsers.delete(telegramId);
    console.log(`Removed user ${telegramId} from trading engine`);
  }

  async handleTradeSignal(tradeSignal) {
    if (!this.activeUsers.size) return;

    console.log('Processing trade signal for', this.activeUsers.size, 'users');
    
    // Add to queue for each active user
    for (const [telegramId, userData] of this.activeUsers) {
      if (!userData.settings.auto_trading) continue;
      
      // Check rate limits
      if (!this.canUserTrade(telegramId, userData)) continue;
      
      this.tradeQueue.push({
        telegramId,
        userData,
        tradeSignal,
        timestamp: Date.now()
      });
    }
  }

  canUserTrade(telegramId, userData) {
    const now = Date.now();
    
    // Reset hourly counter
    if (now > userData.hourlyReset) {
      userData.tradesThisHour = 0;
      userData.hourlyReset = now + 3600000;
    }
    
    // Check hourly limit
    if (userData.tradesThisHour >= userData.settings.max_trades_per_hour) {
      console.log(`User ${telegramId} hit hourly trade limit`);
      return false;
    }
    
    // Check minimum time between trades (30 seconds)
    if (now - userData.lastTradeTime < 30000) {
      console.log(`User ${telegramId} trading too frequently`);
      return false;
    }
    
    return true;
  }

  async processTradeQueue() {
    if (this.processing || this.tradeQueue.length === 0) {
      setTimeout(() => this.processTradeQueue(), 1000);
      return;
    }
    
    this.processing = true;
    
    try {
      const trade = this.tradeQueue.shift();
      if (trade) {
        await this.executeTrade(trade);
      }
    } catch (error) {
      console.error('Error processing trade queue:', error.message);
    }
    
    this.processing = false;
    setTimeout(() => this.processTradeQueue(), 2000); // 2 second delay between trades
  }

  async executeTrade(trade) {
    const { telegramId, userData, tradeSignal } = trade;
    
    try {
      console.log(`Executing trade for user ${telegramId}:`, tradeSignal.tokenSymbol);
      
      // Calculate trade amount
      const tradeAmount = Math.min(
        userData.settings.max_trade_amount,
        tradeSignal.amountIn * 0.1 // 10% of alpha trader's amount
      );
      
      // Get Jupiter quote
      const quote = await this.getJupiterQuote(
        'So11111111111111111111111111111111111111112', // SOL
        tradeSignal.tokenAddress,
        tradeAmount * 1e9 // Convert to lamports
      );
      
      if (!quote) {
        console.log('Could not get quote for trade');
        return;
      }
      
      // Simulate the trade (for safety in demo)
      const simulatedTx = await this.simulateTrade(quote, userData.walletAddress);
      
      if (simulatedTx.success) {
        // Save trade record
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
        
        // Update user stats
        userData.lastTradeTime = Date.now();
        userData.tradesThisHour++;
        
        // Emit trade completion event
        this.emit('tradeCompleted', {
          telegramId,
          tradeRecord,
          tokenSymbol: tradeSignal.tokenSymbol,
          tokenName: tradeSignal.tokenName
        });
        
        console.log(`✅ Trade completed for user ${telegramId}`);
      }
      
    } catch (error) {
      console.error(`Error executing trade for user ${telegramId}:`, error.message);
      
      // Emit trade error event
      this.emit('tradeError', {
        telegramId,
        error: error.message,
        tokenSymbol: tradeSignal.tokenSymbol
      });
    }
  }

  async getJupiterQuote(inputMint, outputMint, amount) {
    try {
      const response = await axios.get('https://quote-api.jup.ag/v6/quote', {
        params: {
          inputMint,
          outputMint,
          amount,
          slippageBps: 500 // 5% slippage
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('Error getting Jupiter quote:', error.message);
      return null;
    }
  }

  async simulateTrade(quote, walletAddress) {
    // This is a simulation for demo purposes
    // In production, you would execute the actual trade
    
    try {
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      
      // Simulate success/failure (90% success rate)
      const success = Math.random() > 0.1;
      
      return {
        success,
        signature: success ? this.generateMockSignature() : null,
        error: success ? null : 'Simulation failed'
      };
    } catch (error) {
      return {
        success: false,
        signature: null,
        error: error.message
      };
    }
  }

  generateMockSignature() {
    // Generate a realistic looking Solana transaction signature
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
      const userData = this.activeUsers.get(telegramId);
      userData.settings = settings;
      console.log(`Updated settings for user ${telegramId}`);
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
