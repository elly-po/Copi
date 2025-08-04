const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class Config {
    constructor() {
        // Path configuration
        this.configDir = path.join(__dirname, '..', 'data');
        this.configPath = path.join(this.configDir, 'config.json');
        this.secretsPath = path.join(this.configDir, 'secrets.enc');

        // Initialize with defaults
        this.defaultConfig = this.buildDefaultConfig();
        
        // Ensure directories exist
        this.initializeSync();
    }

    buildDefaultConfig() {
        return {
            solana: {
                rpcUrl: process.env.SOLANA_RPC_URL || 
                       (process.env.HELIUS_API_KEY 
                        ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
                        : 'https://api.mainnet-beta.solana.com'),
                wsUrl: process.env.HELIUS_WS_URL || null,
                commitment: 'confirmed',
                pollInterval: parseInt(process.env.POLL_INTERVAL) || 15000
            },
            jupiter: {
                apiUrl: 'https://quote-api.jup.ag/v6',
                swapUrl: 'https://quote-api.jup.ag/v6/swap',
                maxRequestsPerMinute: parseInt(process.env.JUPITER_RATE_LIMIT) || 30
            },
            telegram: {
                botToken: process.env.TELEGRAM_BOT_TOKEN || null,
                rateLimit: {
                    windowMs: 60000,
                    max: parseInt(process.env.TELEGRAM_RATE_LIMIT) || 15
                }
            },
            trading: {
                maxSlippage: parseFloat(process.env.MAX_SLIPPAGE) || 5,
                defaultTradeAmount: parseFloat(process.env.DEFAULT_TRADE_AMOUNT) || 0.01,
                maxTradesPerToken: parseInt(process.env.MAX_TRADES_PER_TOKEN) || 3,
                defaultDelay: parseInt(process.env.DEFAULT_DELAY) || 2000,
                minTradeAmount: parseFloat(process.env.MIN_TRADE_AMOUNT) || 0.001,
                maxTradeAmount: parseFloat(process.env.MAX_TRADE_AMOUNT) || 5
            },
            security: {
                encryptionKey: process.env.ENCRYPTION_KEY || this.generateTempKey(),
                rpcRateLimit: parseInt(process.env.RPC_RATE_LIMIT) || 15
            }
        };
    }

    generateTempKey() {
        const tempKey = crypto.randomBytes(32).toString('hex');
        console.warn('⚠️ Using temporary encryption key - DO NOT USE IN PRODUCTION');
        return tempKey;
    }

    initializeSync() {
        try {
            // Ensure data directory exists
            if (!fs.existsSync(this.configDir)) {
                fs.mkdirSync(this.configDir, { recursive: true });
            }

            // Initialize config file if missing
            if (!fs.existsSync(this.configPath)) {
                fs.writeJsonSync(this.configPath, this.defaultConfig, { spaces: 2 });
            }

            // Validate critical configuration
            this.validateSync();
        } catch (error) {
            console.error('🚨 Config initialization failed:', error);
            throw error;
        }
    }

    validateSync() {
        const config = this.getSync();
        
        // Check Telegram token
        if (!config.telegram.botToken) {
            throw new Error('Missing TELEGRAM_BOT_TOKEN in .env');
        }

        // Check encryption key in production
        if (process.env.NODE_ENV === 'production' && 
            config.security.encryptionKey === this.defaultConfig.security.encryptionKey) {
            throw new Error('ENCRYPTION_KEY must be set in production');
        }

        return true;
    }

    getSync() {
        try {
            const fileConfig = fs.existsSync(this.configPath) 
                ? fs.readJsonSync(this.configPath) 
                : {};
            return { ...this.defaultConfig, ...fileConfig };
        } catch (error) {
            console.error('Failed to read config synchronously:', error);
            return this.defaultConfig;
        }
    }

    async get() {
        try {
            const fileConfig = await fs.readJson(this.configPath);
            return { ...this.defaultConfig, ...fileConfig };
        } catch (error) {
            console.error('Failed to read config:', error);
            return this.defaultConfig;
        }
    }

    async update(newConfig) {
        try {
            const current = await this.get();
            const updated = { ...current, ...newConfig };
            await fs.writeJson(this.configPath, updated, { spaces: 2 });
            return updated;
        } catch (error) {
            console.error('Failed to update config:', error);
            throw error;
        }
    }
}

// Initialize and export instance
const config = new Config();
module.exports = config;