require('dotenv').config();
const WalletTracker = require('./wallet-tracker');
const TradingEngine = require('./trading-engine');
const CopyTradingBot = require('./telegram-bot');
const Database = require('./database');

class CopyTradingSystem {
  constructor() {
    this.walletTracker = new WalletTracker();
    this.tradingEngine = new TradingEngine();
    this.telegramBot = CopyTradingBot;
    this.isRunning = false;
  }

  async initialize() {
    try {
      console.log('🚀 Initializing Copy Trading System...');

      // Initialize trading engine
      await this.tradingEngine.initialize();

      // Add some default alpha wallets for tracking
      await this.addDefaultWallets();

      // Set up event listeners
      this.setupEventListeners();

      // Start wallet tracker
      await this.walletTracker.start();

      this.isRunning = true;
      console.log('✅ Copy Trading System is running!');
      console.log('📱 Telegram bot is ready for users');
      console.log('👀 Tracking wallets for alpha trades');

    } catch (error) {
      console.error('❌ Failed to initialize system:', error);
      process.exit(1);
    }
  }

  setupEventListeners() {
    // Listen for trade signals from wallet tracker
    this.walletTracker.on('tradeSignal', (tradeSignal) => {
      console.log('📡 Received trade signal:', tradeSignal.tokenSymbol);
      this.tradingEngine.handleTradeSignal(tradeSignal);
    });

    // Listen for completed trades from trading engine
    this.tradingEngine.on('tradeCompleted', (tradeData) => {
      console.log('✅ Trade completed for user:', tradeData.telegramId);
      this.telegramBot.sendTradeNotification(tradeData.telegramId, tradeData);
    });

    // Listen for trade errors from trading engine
    this.tradingEngine.on('tradeError', (errorData) => {
      console.log('❌ Trade error for user:', errorData.telegramId);
      this.telegramBot.sendTradeError(errorData.telegramId, errorData);
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async addDefaultWallets() {
    try {
      // Add some well-known alpha wallets (these are examples - replace with real ones)
      const defaultWallets = [
        {
          address: '7xJDgPgUtMLLrFp7E7JHgQpcK4DJDdqhJsnEgUZjbvG9',
          name: 'Alpha Trader 1'
        },
        {
          address: '8nVnbEy3Zf8GpK9gLxC3sQGPKtNzVNzN3vkrLZfJpqxy',
          name: 'Memecoin Master'
        },
        {
          address: '9gCPMy6fPMVeqN4vQJtXyF2sKnvQpWxvLFe8dBgHs3Nt',
          name: 'Sol Sniper'
        }
      ];

      for (const wallet of defaultWallets) {
        await this.walletTracker.addWallet(wallet.address, wallet.name);
      }

      console.log(`✅ Added ${defaultWallets.length} default alpha wallets to tracking`);
    } catch (error) {
      console.error('Error adding default wallets:', error);
    }
  }

  async addUserToTrading(telegramId, walletAddress) {
    try {
      await this.tradingEngine.addUser(telegramId, walletAddress);
      console.log(`👤 Added user ${telegramId} to trading engine`);
      return true;
    } catch (error) {
      console.error('Error adding user to trading:', error);
      return false;
    }
  }

  async removeUserFromTrading(telegramId) {
    try {
      await this.tradingEngine.removeUser(telegramId);
      console.log(`👤 Removed user ${telegramId} from trading engine`);
      return true;
    } catch (error) {
      console.error('Error removing user from trading:', error);
      return false;
    }
  }

  async updateUserSettings(telegramId) {
    try {
      await this.tradingEngine.updateUserSettings(telegramId);
      console.log(`⚙️ Updated settings for user ${telegramId}`);
      return true;
    } catch (error) {
      console.error('Error updating user settings:', error);
      return false;
    }
  }

  getSystemStats() {
    return {
      isRunning: this.isRunning,
      trackedWallets: this.walletTracker.getTrackedWallets().length,
      activeUsers: this.tradingEngine.getActiveUsers().length,
      uptime: process.uptime()
    };
  }

  async shutdown() {
    console.log('\n🛑 Shutting down Copy Trading System...');
    
    try {
      // Stop wallet tracker
      await this.walletTracker.stop();
      
      // Close database connection
      Database.close();
      
      console.log('✅ System shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Start the system
const system = new CopyTradingSystem();

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  system.shutdown();
});

// Initialize and start
system.initialize().catch(error => {
  console.error('Failed to start system:', error);
  process.exit(1);
});

module.exports = CopyTradingSystem;
