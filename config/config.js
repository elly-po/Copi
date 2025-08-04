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
        this.ensureConfigExists();
    }

    // ... (keep existing ensureConfigExists, get, update methods)

    validateEnvironment() {
        const required = [
            'TELEGRAM_BOT_TOKEN',
            'ENCRYPTION_KEY' // Now required
        ];

        const missing = required.filter(env => !process.env[env]);
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }
    }
}

module.exports = new Config();
