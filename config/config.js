const fs = require('fs-extra');
const path = require('path');

class Config {
    constructor() {
        this.configPath = path.join(__dirname, '..', 'data', 'config.json');
        this.defaultConfig = {
            solana: {
                rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
                wsUrl: process.env.HELIUS_WS_URL || 'wss://atlas-mainnet.helius-rpc.com',
                commitment: 'finalized'
            },
            jupiter: {
                apiUrl: 'https://quote-api.jup.ag/v6',
                swapUrl: 'https://quote-api.jup.ag/v6/swap'
            },
            telegram: {
                botToken: process.env.TELEGRAM_BOT_TOKEN,
                rateLimit: {
                    windowMs: 60000, // 1 minute
                    max: 30 // 30 requests per minute
                }
            },
            trading: {
                maxSlippage: 5, // 5%
                defaultTradeAmount: 0.01, // 0.01 SOL
                maxTradesPerToken: 5,
                defaultDelay: 1000, // 1 second
                minTradeAmount: 0.001, // Minimum 0.001 SOL
                maxTradeAmount: 10 // Maximum 10 SOL
            },
            security: {
                encryptionKey: process.env.ENCRYPTION_KEY || 'your-32-char-secret-key-here!!!'
            }
        };
        this.ensureConfigExists();
    }

    async ensureConfigExists() {
        try {
            await fs.ensureDir(path.dirname(this.configPath));
            if (!await fs.pathExists(this.configPath)) {
                await fs.writeJson(this.configPath, this.defaultConfig, { spaces: 2 });
            }
        } catch (error) {
            console.error('Error ensuring config exists:', error);
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

    // Environment variable validation
    validateEnvironment() {
        const required = [
            'TELEGRAM_BOT_TOKEN',
            'SOLANA_RPC_URL',
            'HELIUS_WS_URL'
        ];

        const missing = required.filter(env => !process.env[env]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }
    }
}

module.exports = new Config();