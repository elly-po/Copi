const config = require('./config/config');
const telegram = require('./telegrambot/grammy');
const blockchain = require('./blockchain/blockchainMonitor');
const tradeExecutor = require('./services/tradeExecutor');
const database = require('./database/database');
const rateLimiter = require('./utils/rateLimiter');

class App {
    async start() {
        try {
            // Validate environment
            config.validateEnvironment();
            
            // Initialize modules
            await database.initializeDatabase();
            telegram.start();
            
            // Start services with free-tier limits
            await this.startWithLimits();
            
            console.log('🚀 Alpha Mimic Bot (Free Tier) is operational');
            console.log('⚠️ Tracking limit: 3 wallets max');
            
            // Maintenance jobs
            setInterval(() => database.cleanup(), 3600000);
        } catch (error) {
            console.error('❌ Failed to start:', error);
            process.exit(1);
        }
    }

    async startWithLimits() {
        // Enforce free-tier wallet limit
        const wallets = await database.getAllActiveAlphaWallets();
        if (wallets.length > 3) {
            console.warn('Free tier only supports 3 wallets! Using first 3');
            await database.deactivateWallets(wallets.slice(3));
        }

        // Start monitoring with rate limits
        await Promise.all([
            rateLimiter.check('rpc-init', 5),
            blockchain.startMonitoring()
        ]);
    }

    async gracefulShutdown() {
        console.log('🛑 Graceful shutdown...');
        await blockchain.stopMonitoring();
        process.exit(0);
    }
}

// Handle process termination
process.on('SIGTERM', () => new App().gracefulShutdown());
process.on('SIGINT', () => new App().gracefulShutdown());

// Start with error handling
new App().start().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
