require('dotenv').config();

const config = require('./config/config');
const database = require('./database/database');
const walletManager = require('./wallet/walletManager');
const blockchainMonitor = require('./blockchain/blockchainMonitor');
const jupiterTrader = require('./trading/jupiterTrader');
const copyTrader = require('./trading/copyTrader');
const telegramBot = require('./telegram/telegramBot');
const cron = require('node-cron');

class SolanaAlphaBot {
    constructor() {
        this.isRunning = false;
        this.components = {
            config: config,
            database: database,
            walletManager: walletManager,
            blockchainMonitor: blockchainMonitor,
            jupiterTrader: jupiterTrader,
            copyTrader: copyTrader,
            telegramBot: telegramBot
        };
    }

    async initialize() {
        console.log('🚀 Starting Solana Alpha Wallet Copy Bot...\n');

        try {
            // Validate environment variables
            console.log('🔍 Validating environment...');
            config.validateEnvironment();
            console.log('✅ Environment validated\n');

            // Initialize database
            console.log('📊 Initializing database...');
            await database.initializeDatabase();
            console.log('✅ Database initialized\n');

            // Initialize wallet manager
            console.log('💳 Initializing wallet manager...');
            await walletManager.initializeConnection();
            console.log('✅ Wallet manager initialized\n');

            // Initialize Jupiter trader
            console.log('🔄 Initializing Jupiter trader...');
            await jupiterTrader.initializeTrader();
            console.log('✅ Jupiter trader initialized\n');

            // Initialize Telegram bot
            console.log('🤖 Initializing Telegram bot...');
            await telegramBot.initialize();
            console.log('✅ Telegram bot initialized\n');

            // Set up event listeners
            this.setupEventListeners();

            // Start services
            await this.startServices();

            // Schedule cleanup tasks
            this.scheduleCleanupTasks();

            console.log('🎉 Bot initialization completed successfully!\n');
            console.log('📊 System Status:');
            await this.printSystemStatus();

        } catch (error) {
            console.error('❌ Initialization failed:', error);
            process.exit(1);
        }
    }

    setupEventListeners() {
        console.log('🔗 Setting up event listeners...');

        // Listen for detected swaps from blockchain monitor
        blockchainMonitor.on('swapDetected', async (swapData) => {
            console.log(`🔥 Swap detected from ${swapData.wallet}: ${swapData.type}`);
            await copyTrader.processAlphaSwap(swapData);
        });

        // Listen for completed copy trades
        copyTrader.on('tradeCompleted', async (data) => {
            console.log(`✅ Copy trade completed for user ${data.userId}`);
            await telegramBot.sendTradeNotification(data.userId, data);
        });

        // Listen for copy trade errors
        copyTrader.on('tradeError', async (data) => {
            console.log(`❌ Copy trade failed for user ${data.userId}: ${data.error}`);
            await telegramBot.sendNotification(
                data.userId,
                `❌ *Trade Failed*\n\nError: ${data.error}`,
                { silent: false }
            );
        });

        // Handle blockchain monitor errors
        blockchainMonitor.on('error', (error) => {
            console.error('❌ Blockchain monitor error:', error);
        });

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Received SIGINT, shutting down gracefully...');
            this.shutdown();
        });

        process.on('SIGTERM', () => {
            console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
            this.shutdown();
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('❌ Uncaught exception:', error);
            this.shutdown();
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
        });

        console.log('✅ Event listeners configured\n');
    }

    async startServices() {
        console.log('🔄 Starting services...');

        try {
            // Start Telegram bot
            await telegramBot.start();

            // Start blockchain monitoring
            await blockchainMonitor.startMonitoring();

            this.isRunning = true;
            console.log('✅ All services started\n');

        } catch (error) {
            console.error('❌ Error starting services:', error);
            throw error;
        }
    }

    scheduleCleanupTasks() {
        console.log('📅 Scheduling cleanup tasks...');

        // Clean up database every hour
        cron.schedule('0 * * * *', async () => {
            console.log('🧹 Running hourly cleanup...');
            try {
                await database.cleanup();
                copyTrader.cleanupTradeCounters();
                console.log('✅ Cleanup completed');
            } catch (error) {
                console.error('❌ Cleanup error:', error);
            }
        });

        // Health check every 5 minutes
        cron.schedule('*/5 * * * *', async () => {
            try {
                await this.healthCheck();
            } catch (error) {
                console.error('❌ Health check failed:', error);
            }
        });

        // Status report every hour
        cron.schedule('0 * * * *', async () => {
            console.log('📊 Hourly Status Report:');
            await this.printSystemStatus();
        });

        console.log('✅ Cleanup tasks scheduled\n');
    }

    async healthCheck() {
        const checks = {
            rpc: await walletManager.isHealthy(),
            jupiter: await jupiterTrader.isHealthy(),
            telegram: telegramBot.getStats().isRunning,
            monitor: blockchainMonitor.getStatus().isMonitoring
        };

        const unhealthy = Object.entries(checks)
            .filter(([_, healthy]) => !healthy)
            .map(([service, _]) => service);

        if (unhealthy.length > 0) {
            console.log(`⚠️ Unhealthy services: ${unhealthy.join(', ')}`);
            
            // Attempt to restart unhealthy services
            for (const service of unhealthy) {
                try {
                    await this.restartService(service);
                } catch (error) {
                    console.error(`❌ Failed to restart ${service}:`, error);
                }
            }
        }
    }

    async restartService(serviceName) {
        console.log(`🔄 Restarting ${serviceName}...`);
        
        switch (serviceName) {
            case 'monitor':
                await blockchainMonitor.stopMonitoring();
                await blockchainMonitor.startMonitoring();
                break;
            case 'telegram':
                await telegramBot.stop();
                await telegramBot.start();
                break;
            case 'rpc':
                await walletManager.initializeConnection();
                break;
            case 'jupiter':
                await jupiterTrader.initializeTrader();
                break;
        }
        
        console.log(`✅ ${serviceName} restarted`);
    }

    async printSystemStatus() {
        try {
            const monitorStatus = blockchainMonitor.getStatus();
            const traderStatus = copyTrader.getStatus();
            const botStats = telegramBot.getStats();
            const networkStats = await walletManager.getNetworkStats();
            
            console.log(`
┌─────────────────────────────────────────┐
│              SYSTEM STATUS              │
├─────────────────────────────────────────┤
│ 🤖 Bot Status: ${this.isRunning ? '✅ Running      ' : '❌ Stopped      '} │
│ 🔌 Telegram: ${botStats.isRunning ? '✅ Connected   ' : '❌ Disconnected '} │
│ 👀 Monitoring: ${monitorStatus.isMonitoring ? '✅ Active      ' : '❌ Inactive     '} │
│ 🌐 WebSocket: ${monitorStatus.wsConnected ? '✅ Connected   ' : '❌ Disconnected '} │
├─────────────────────────────────────────┤
│ 👑 Alpha Wallets: ${String(monitorStatus.monitoredWallets).padEnd(15)} │
│ 📊 Subscriptions: ${String(monitorStatus.subscriptions).padEnd(15)} │
│ ⏳ Trade Queue: ${String(traderStatus.queueLength).padEnd(17)} │
│ 🔄 Active Trades: ${String(traderStatus.activeTrades).padEnd(15)} │
├─────────────────────────────────────────┤
│ 🌐 Network: ${networkStats ? `Epoch ${networkStats.epoch}`.padEnd(19) : 'Unknown            '} │
│ 🕒 Uptime: ${this.getUptime().padEnd(20)} │
└─────────────────────────────────────────┘
            `);

        } catch (error) {
            console.error('❌ Error printing system status:', error);
        }
    }

    getUptime() {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }

    async shutdown() {
        if (!this.isRunning) {
            console.log('⚠️ Bot is not running');
            process.exit(0);
        }

        console.log('🛑 Shutting down services...');
        this.isRunning = false;

        try {
            // Stop copy trading
            copyTrader.stop();
            console.log('✅ Copy trader stopped');

            // Stop blockchain monitoring
            await blockchainMonitor.stopMonitoring();
            console.log('✅ Blockchain monitor stopped');

            // Stop Telegram bot
            await telegramBot.stop();
            console.log('✅ Telegram bot stopped');

            console.log('✅ Graceful shutdown completed');
            process.exit(0);

        } catch (error) {
            console.error('❌ Error during shutdown:', error);
            process.exit(1);
        }
    }

    // CLI commands for debugging
    async handleCommand(command, args) {
        switch (command) {
            case 'status':
                await this.printSystemStatus();
                break;
                
            case 'restart':
                const service = args[0];
                if (service) {
                    await this.restartService(service);
                } else {
                    console.log('Usage: restart <service>');
                }
                break;
                
            case 'broadcast':
                const message = args.join(' ');
                if (message) {
                    await telegramBot.broadcast(`📢 Admin Message: ${message}`);
                    console.log('✅ Broadcast sent');
                } else {
                    console.log('Usage: broadcast <message>');
                }
                break;
                
            default:
                console.log('Available commands: status, restart, broadcast');
        }
    }
}

// Create and start the bot
const bot = new SolanaAlphaBot();

// Handle CLI arguments
const args = process.argv.slice(2);
if (args.length > 0) {
    const [command, ...commandArgs] = args;
    bot.handleCommand(command, commandArgs);
} else {
    // Normal startup
    bot.initialize().catch(error => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
}

module.exports = bot;