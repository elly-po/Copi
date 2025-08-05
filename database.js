const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor() {
    this.db = new sqlite3.Database(process.env.DATABASE_PATH || './trading_bot.db');
    this.initTables();
  }

  initTables() {
    // Users table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        telegram_id TEXT UNIQUE,
        wallet_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 1
      )
    `);

    // User settings table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY,
        telegram_id TEXT UNIQUE,
        max_trade_amount REAL DEFAULT 0.1,
        slippage REAL DEFAULT 5,
        min_liquidity REAL DEFAULT 1000,
        auto_trading BOOLEAN DEFAULT 0,
        tracking_period INTEGER DEFAULT 300,
        max_trades_per_hour INTEGER DEFAULT 10,
        FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
      )
    `);

    // Tracked wallets table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tracked_wallets (
        id INTEGER PRIMARY KEY,
        wallet_address TEXT UNIQUE,
        name TEXT,
        is_active BOOLEAN DEFAULT 1,
        success_rate REAL DEFAULT 0,
        total_trades INTEGER DEFAULT 0,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Trades table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY,
        telegram_id TEXT,
        alpha_wallet TEXT,
        token_address TEXT,
        trade_type TEXT,
        amount REAL,
        price REAL,
        signature TEXT,
        profit_loss REAL DEFAULT 0,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
      )
    `);
  }

  // User methods
  async createUser(telegramId, walletAddress = null) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT OR REPLACE INTO users (telegram_id, wallet_address) VALUES (?, ?)',
        [telegramId, walletAddress],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getUser(telegramId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM users WHERE telegram_id = ?',
        [telegramId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  // Settings methods
  async getUserSettings(telegramId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM user_settings WHERE telegram_id = ?',
        [telegramId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || this.getDefaultSettings(telegramId));
        }
      );
    });
  }

  async updateUserSettings(telegramId, settings) {
    return new Promise((resolve, reject) => {
      const keys = Object.keys(settings);
      const values = Object.values(settings);
      const placeholders = keys.map(key => `${key} = ?`).join(', ');
      
      this.db.run(
        `INSERT OR REPLACE INTO user_settings (telegram_id, ${keys.join(', ')}) 
         VALUES (?, ${values.map(() => '?').join(', ')})`,
        [telegramId, ...values],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  getDefaultSettings(telegramId) {
    return {
      telegram_id: telegramId,
      max_trade_amount: parseFloat(process.env.DEFAULT_MAX_TRADE_AMOUNT) || 0.1,
      slippage: parseFloat(process.env.DEFAULT_SLIPPAGE) || 5,
      min_liquidity: parseFloat(process.env.DEFAULT_MIN_LIQUIDITY) || 1000,
      auto_trading: false,
      tracking_period: 300,
      max_trades_per_hour: 10
    };
  }

  // Tracked wallets methods
  async addTrackedWallet(address, name) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT OR REPLACE INTO tracked_wallets (wallet_address, name) VALUES (?, ?)',
        [address, name],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getTrackedWallets() {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM tracked_wallets WHERE is_active = 1',
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  // Trades methods
  async saveTrade(trade) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT INTO trades 
        (telegram_id, alpha_wallet, token_address, trade_type, amount, price, signature, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [trade.telegramId, trade.alphaWallet, trade.tokenAddress, trade.tradeType, 
         trade.amount, trade.price, trade.signature, trade.status],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getUserTrades(telegramId, limit = 20) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM trades WHERE telegram_id = ? ORDER BY created_at DESC LIMIT ?',
        [telegramId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  close() {
    this.db.close();
  }
}

module.exports = new Database();
