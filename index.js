// index.js

import dotenv from 'dotenv';
dotenv.config(); // Load .env first

import Config from './config/index.js';
import database from './database/database.js';

const config = new Config();

class App {
  constructor() {
    this.cleanupInterval = null;
    this.isShuttingDown = false;
  }

  async start() {
    try {
      console.log('⚙️  Initializing Alpha Mimic Bot...');

      this.validateEnvironment(); // Phase 1
      await database.initializeDatabase();

      await this.startServices(); // Phase 2

      console.log('✅ Bot is fully operational'); // Phase 3
      this.scheduleMaintenance();
      await this.setupHealthCheck();

    } catch (error) {
      console.error('💥 Boot failed:', error.stack || error.message);
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
        console.log('🔑 Missing ENCRYPTION_KEY in production.');
        console.log('💡 Generate one with this terminal command:');
        console.log('   openssl rand -base64 32');
      }
      throw error;
    }
  }

  async startServices() {
    const [telegramBot, blockchainMonitor] = await Promise.all([
      import('./telegrambot/grammy.js'),
      import('./blockchain/blockchainMonitor.js')
    ]);

    await Promise.all([
      telegramBot.default.start(),
      blockchainMonitor.default.startMonitoring()
    ]);
  }

  scheduleMaintenance() {
    this.cleanupInterval = setInterval(async () => {
      try {
        await database.cleanup();
      } catch (error) {
        console.error('🧹 Cleanup job failed:', error.message);
      }
    }, 1000 * 60 * 60); // Run hourly
  }

  async setupHealthCheck() {
    if (!process.env.HEALTH_CHECK_PORT) return;

    const { default: express } = await import('express');
    const app = express();

    app.get('/health', (_req, res) => {
      res.status(this.isShuttingDown ? 503 : 200).json({
        status: this.isShuttingDown ? 'shutting_down' : 'healthy'
      });
    });

    app.listen(process.env.HEALTH_CHECK_PORT, () => {
      console.log(`🩺 Health check ready at port ${process.env.HEALTH_CHECK_PORT}`);
    });
  }

  async gracefulShutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log('\n🛑 Shutting down gracefully...');
    clearInterval(this.cleanupInterval);

    try {
      const { default: blockchainMonitor } = await import('./blockchain/blockchainMonitor.js');
      await blockchainMonitor.stopMonitoring();
    } catch (error) {
      console.error('🚨 Error during shutdown:', error.message);
    }

    process.exit(0);
  }
}

// Handle OS signals
const app = new App();
process.on('SIGTERM', () => app.gracefulShutdown());
process.on('SIGINT', () => app.gracefulShutdown());

app.start().catch(err => {
  console.error('🔥 Fatal startup error:', err.stack || err.message);
  process.exit(1);
});