const fs = require('fs-extra');
const path = require('path');

class Config {
    constructor() {
        this.configPath = path.join(__dirname, '..', 'data', 'config.json');
        this.defaultConfig = {
            solana: {
                rpcUrl: process.env.SOLANA_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
                wsUrl: null, // Disabled for free tier
                commitment: 'confirmed', // Faster confirmation
                pollInterval: 15000 // 15 seconds
            },
            jupiter: {
                apiUrl: 'https://quote-api.jup.ag/v6',
                swapUrl: 'https://quote-api.jup.ag/v6/swap',
                maxRequestsPerMinute: 30 // Jupiter API limits
            },
            telegram: {
                botToken: process.env.TELEGRAM_BOT_TOKEN,
                rateLimit: {
                    windowMs: 60000,
                    max: 15 // Reduced for free tier
                }
            },
            trading: {
                maxSlippage: 5,
                defaultTradeAmount: 0.01,
                maxTradesPerToken: 3, // Reduced for free tier
                defaultDelay: 2000, // Increased delay
                minTradeAmount: 0.001,
                maxTradeAmount: 5 // Reduced max
            },
            security: {
                encryptionKey: process.env.ENCRYPTION_KEY,
                rpcRateLimit: 15 // Requests per second
            }
        };

        // Initialize synchronously
        this.initializeSync();
    }

    initializeSync() {
        // Create data directory if needed
        fs.ensureDirSync(path.dirname(this.configPath));
        
        // Initialize config file if it doesn't exist
        if (!fs.existsSync(this.configPath)) {
            fs.writeJsonSync(this.configPath, this.defaultConfig, { spaces: 2 });
        }
    }

    async ensureConfigExists() {
        try {
            await fs.ensureDir(path.dirname(this.configPath));
            if (!await fs.pathExists(this.configPath)) {
                await fs.writeJson(this.configPath, this.defaultConfig, { spaces: 2 });
            }
        } catch (error) {
            console.error('Error ensuring config exists:', error);
            throw error;
        }
    }

    async get() {
        try {
            const config = await fs.readJson(this.configPath);
            return { ...this.defaultConfig, ...config };
        } catch (error) {
            console.error('Error reading config:', error);
            return this.defaultConfig;
        }
    }

    async update(newConfig) {
        try {
            const currentConfig = await this.get();
            const updatedConfig = { ...currentConfig, ...newConfig };
            await fs.writeJson(this.configPath, updatedConfig, { spaces: 2 });
            return updatedConfig;
        } catch (error) {
            console.error('Error updating config:', error);
            throw error;
        }
    }

    validateEnvironment() {
        const required = [
            'TELEGRAM_BOT_TOKEN',
            'ENCRYPTION_KEY'
        ];

        const missing = required.filter(env => !process.env[env]);
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }
    }
}

// Export initialized instance
const configInstance = new Config();
module.exports = configInstance;