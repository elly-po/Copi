// index.js

import dotenv from 'dotenv';
dotenv.config(); // Must be first

import config from './config/index.js';
import database from './database/database.js';

class App {
  constructor() {
    this.cleanupInterval = null;
    this.isShuttingDown = false;
  }

  async start() {
    try {
      console.log('⚙️  Initializing Alpha Mimic Bot...');

      // Phase 1: Critical Systems
      this.validateEnvironment();
      await database.initializeDatabase();

      // Phase 2: Services
      await this.startServices();

      // Phase 3: Operational
      console.log('✅ Bot is fully operational');
      this.scheduleMaintenance();

      // Health check endpoint
      await this.setupHealthCheck();

    } catch (error) {
      console.error('💥 Boot failed:', error.message);
      process.exit(1);
    }
  }

  validateEnvironment() {
    try {
      config.validateSync();
      console.log('🔐 Environment validated');
    } catch (error) {
      console.error('\n❌ Configuration error:', error.message);
      if (error.message.includes('ENCRYPTION_KEY')) {
        console.log('Generate one with:');
        console.log(
          `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
        );
      }
      throw error;
    }
  }

  async startServices() {
    const [telegramModule, blockchainModule] = await Promise.all([
      import('./telegrambot/grammy.js'),
      import('./blockchain/blockchainMonitor.js')
    ]);

    await Promise.all([
      telegramModule.default.start(),
      blockchainModule.default.startMonitoring()
    ]);
  }

  scheduleMaintenance() {
    this.cleanupInterval = setInterval(async () => {
      try {
        await database.cleanup();
      } catch (error) {
        console.error('Cleanup job failed:', error);
      }
    }, 3600000); // Hourly
  }

  async setupHealthCheck() {
    if (process.env.HEALTH_CHECK_PORT) {
      const expressModule = await import('express');
      const express = expressModule.default;
      const app = express();

      app.get('/health', (req, res) => {
        res
          .status(this.isShuttingDown ? 503 : 200)
          .json({ status: this.isShuttingDown ? 'shutting_down' : 'healthy' });
      });

      app.listen(process.env.HEALTH_CHECK_PORT, () => {
        console.log(`🩺 Health check available on port ${process.env.HEALTH_CHECK_PORT}`);
      });
    }
  }

  async gracefulShutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log('\n🛑 Shutting down gracefully...');
    clearInterval(this.cleanupInterval);

    try {
      const blockchainModule = await import('./blockchain/blockchainMonitor.js');
      await blockchainModule.default.stopMonitoring();
    } catch (error) {
      console.error('Shutdown error:', error);
    }

    process.exit(0);
  }
}

// Signal handling
const appInstance = new App();
process.on('SIGTERM', () => appInstance.gracefulShutdown());
process.on('SIGINT', () => appInstance.gracefulShutdown());

// Start the bot
appInstance.start().catch(err => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});