const DatabaseLib = require('better-sqlite3');
const path = require('path');

class Database {
  constructor() {
    const dbPath = process.env.DATABASE_PATH || './trading_bot.db';
    this.db = new DatabaseLib(dbPath);
    this.initTables();
  }

  initTables() {
    // Users table
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        telegram_id TEXT UNIQUE,
        wallet_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 1
      )
    `).run();

    // User settings table
    this.db.prepare(`
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
    `).run();

    // Tracked wallets table
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS tracked_wallets (
        id INTEGER PRIMARY KEY,
        wallet_address TEXT UNIQUE,
        name TEXT,
        is_active BOOLEAN DEFAULT 1,
        success_rate REAL DEFAULT 0,
        total_trades INTEGER DEFAULT 0,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Trades table
    this.db.prepare(`
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
    `).run();
  }

  // User methods
  createUser(telegramId, walletAddress = null) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO users (telegram_id, wallet_address)
      VALUES (?, ?)
    `);
    const info = stmt.run(telegramId, walletAddress);
    return info.lastInsertRowid;
  }

  getUser(telegramId) {
    const stmt = this.db.prepare(`
      SELECT * FROM users WHERE telegram_id = ?
    `);
    return stmt.get(telegramId);
  }

  // Settings methods
  getUserSettings(telegramId) {
    const stmt = this.db.prepare(`
      SELECT * FROM user_settings WHERE telegram_id = ?
    `);
    const row = stmt.get(telegramId);
    return row || this.getDefaultSettings(telegramId);
  }

  updateUserSettings(telegramId, settings) {
    const keys = Object.keys(settings);
    const values = Object.values(settings);
    const columns = keys.join(', ');
    const placeholders = keys.map(() => '?').join(', ');

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO user_settings (telegram_id, ${columns})
      VALUES (?, ${placeholders})
    `);
    const info = stmt.run(telegramId, ...values);
    return info.changes;
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
  addTrackedWallet(address, name) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tracked_wallets (wallet_address, name)
      VALUES (?, ?)
    `);
    const info = stmt.run(address, name);
    return info.lastInsertRowid;
  }

  getTrackedWallets() {
    const stmt = this.db.prepare(`
      SELECT * FROM tracked_wallets WHERE is_active = 1
    `);
    return stmt.all();
  }

  // Trades methods
  saveTrade(trade) {
    const stmt = this.db.prepare(`
      INSERT INTO trades
      (telegram_id, alpha_wallet, token_address, trade_type, amount, price, signature, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      trade.telegramId,
      trade.alphaWallet,
      trade.tokenAddress,
      trade.tradeType,
      trade.amount,
      trade.price,
      trade.signature,
      trade.status
    );
    return info.lastInsertRowid;
  }

  getUserTrades(telegramId, limit = 20) {
    const stmt = this.db.prepare(`
      SELECT * FROM trades
      WHERE telegram_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(telegramId, limit);
  }

  close() {
    this.db.close();
  }
}

module.exports = new Database();
