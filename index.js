require('dotenv').config(); // Must be first
const config = require('./config/config');
const database = require('./database/database');
const rateLimiter = require('./utils/rateLimiter');

class App {
    constructor() {
        this.cleanupInterval = null;
    }

    async start() {
        try {
            // Phase 1: Critical initialization
            console.log('⚙️ Initializing core systems...');
            config.validateSync(); // Synchronous validation
            await database.initializeDatabase();
            
            // Phase 2: Service startup
            console.log('🚀 Starting services...');
            await this.startServices();
            
            // Phase 3: Operational
            console.log('✅ Alpha Mimic Bot is fully operational');
            this.scheduleMaintenance();
            
        } catch (error) {
            console.error('💥 Failed to start:', error.message);
            process.exit(1);
        }
    }

    async startServices() {
        // Enforce free-tier limits
        await this.enforceLimits();
        
        // Start services in parallel with rate limiting
        await Promise.all([
            rateLimiter.check('service-init', 3),
            this.startTelegramBot(),
            this.startBlockchainMonitor()
        ]);
    }

    async enforceLimits() {
        const maxWallets = config.getSync().trading.maxWallets || 3;
        const wallets = await database.getAllActiveAlphaWallets();
        
        if (wallets.length > maxWallets) {
            console.warn(`Free tier limit: Deactivating wallets beyond ${maxWallets}`);
            await database.deactivateWallets(wallets.slice(maxWallets));
        }
    }

    async startTelegramBot() {
        try {
            const telegram = require('./telegrambot/grammy');
            await telegram.start();
        } catch (error) {
            console.error('Failed to start Telegram bot:', error);
            throw error;
        }
    }

    async startBlockchainMonitor() {
        try {
            const blockchain = require('./blockchain/blockchainMonitor');
            await blockchain.startMonitoring();
        } catch (error) {
            console.error('Failed to start blockchain monitor:', error);
            throw error;
        }
    }

    scheduleMaintenance() {
        // Hourly cleanup
        this.cleanupInterval = setInterval(async () => {
            try {
                await database.cleanup();
            } catch (error) {
                console.error('Cleanup job failed:', error);
            }
        }, 3600000);
    }

    async gracefulShutdown() {
        console.log('\n🛑 Shutting down gracefully...');
        
        clearInterval(this.cleanupInterval);
        
        try {
            const blockchain = require('./blockchain/blockchainMonitor');
            await blockchain.stopMonitoring();
        } catch (error) {
            console.error('Failed to stop blockchain monitor:', error);
        }
        
        process.exit(0);
    }
}

// Handle process termination
process.on('SIGTERM', () => new App().gracefulShutdown());
process.on('SIGINT', () => new App().gracefulShutdown());

// Start the application
new App().start();