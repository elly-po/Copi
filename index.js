require('dotenv').config(); // Must be first
const config = require('./config/config');
const database = require('./database/database');

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
            this.setupHealthCheck();
            
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
                console.log('node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
            }
            throw error;
        }
    }

    async startServices() {
        const [telegram, blockchain] = await Promise.all([
            import('./telegrambot/grammy'),
            import('./blockchain/blockchainMonitor')
        ]);
        
        await Promise.all([
            telegram.default.start(),
            blockchain.default.startMonitoring()
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

    setupHealthCheck() {
        if (process.env.HEALTH_CHECK_PORT) {
            const express = require('express');
            const app = express();
            app.get('/health', (req, res) => {
                res.status(this.isShuttingDown ? 503 : 200)
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
            const blockchain = await import('./blockchain/blockchainMonitor');
            await blockchain.default.stopMonitoring();
        } catch (error) {
            console.error('Shutdown error:', error);
        }
        
        process.exit(0);
    }
}

// Signal handling
process.on('SIGTERM', () => new App().gracefulShutdown());
process.on('SIGINT', () => new App().gracefulShutdown());

// Start the bot
new App().start().catch(err => {
    console.error('Fatal initialization error:', err);
    process.exit(1);
});
