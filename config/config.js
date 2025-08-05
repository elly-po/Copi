class Config {
    constructor() {
        this.defaultConfig = {
            solana: {
                rpcUrl: 'https://api.mainnet-beta.solana.com', // or a private Helius HTTPS URL if needed
                wsUrl: `wss://rpc.helius.xyz/v1/${process.env.HELIUS_API_KEY}`,
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
                maxSlippage: 5,
                defaultTradeAmount: 0.01,
                maxTradesPerToken: 5,
                defaultDelay: 1000,
                minTradeAmount: 0.001,
                maxTradeAmount: 10
            },
            security: {
                encryptionKey: process.env.ENCRYPTION_KEY || 'your-32-char-secret-key-here!!!'
            }
        };
    }

    async get() {
        return this.defaultConfig;
    }

    async update(newConfig) {
        // Skip writing to disk — just merge and return
        return { ...this.defaultConfig, ...newConfig };
    }

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
