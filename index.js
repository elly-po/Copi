const config = require('./config/config');
const telegram = require('./telegrambot/grammy');
const blockchain = require('./blockchain/blockchainMonitor');
const tradeExecutor = require('./services/tradeExecutor');
const database = require('./database/database');

class App {
    async start() {
        try {
            // Validate environment
            config.validateEnvironment();
            
            // Initialize modules
            await database.initializeDatabase();
            telegram.start();
            
            // Start blockchain monitoring
            await blockchain.startMonitoring();
            
            console.log('🚀 Alpha Mimic Bot is fully operational');
            
            // Cleanup jobs
            setInterval(() => database.cleanup(), 3600000); // Hourly
        } catch (error) {
            console.error('❌ Failed to start application:', error);
            process.exit(1);
        }
    }

    async gracefulShutdown() {
        console.log('🛑 Shutting down...');
        await blockchain.stopMonitoring();
        process.exit(0);
    }
}

// Handle process termination
process.on('SIGTERM', () => new App().gracefulShutdown());
process.on('SIGINT', () => new App().gracefulShutdown());

// Start the application
new App().start();
