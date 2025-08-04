import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';

class Config {
    constructor() {
        this.configPath = path.join(__dirname, '..', 'data', 'config.json');
        this.defaultConfig = this.buildDefaultConfig();
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
                adminChatIds: process.env.ADMIN_CHAT_IDS || '',
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
                maxTradeAmount: parseFloat(process.env.MAX_TRADE_AMOUNT) || 5,
                maxWallets: parseInt(process.env.MAX_WALLETS) || 3
            },
            security: {
                encryptionKey: process.env.ENCRYPTION_KEY || this.generateTempKey(),
                requireSecureKey: process.env.NODE_ENV === 'production'
            }
        };
    }

    generateTempKey() {
        if (process.env.NODE_ENV === 'production') {
            return null; // Will trigger validation error
        }
        const key = crypto.randomBytes(32).toString('base64');
        console.warn('⚠️  Using TEMPORARY encryption key (DO NOT USE IN PRODUCTION):', key);
        return key;
    }

    initializeSync() {
        try {
            fs.ensureDirSync(path.dirname(this.configPath));
            if (!fs.existsSync(this.configPath)) {
                fs.writeJsonSync(this.configPath, this.defaultConfig, { spaces: 2 });
            }
            this.validateSync();
        } catch (error) {
            console.error('🚨 Config initialization failed:', error.message);
            if (error.message.includes('ENCRYPTION_KEY')) {
                console.log('\n🔧 How to fix:');
                console.log('1. Generate key: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
                console.log('2. Add to Render.com environment as ENCRYPTION_KEY');
            }
            throw error;
        }
    }

    validateSync() {
        const isProduction = process.env.NODE_ENV === 'production';
        const config = this.getSync();

        if (isProduction && !process.env.ENCRYPTION_KEY) {
            throw new Error('ENCRYPTION_KEY must be set in production');
        }

        if (!config.telegram.botToken) {
            throw new Error('TELEGRAM_BOT_TOKEN is required');
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
            console.error('Config read failed:', error);
            return this.defaultConfig;
        }
    }

    async get() {
        try {
            const fileConfig = await fs.readJson(this.configPath);
            return { ...this.defaultConfig, ...fileConfig };
        } catch (error) {
            console.error('Async config read failed:', error);
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
            console.error('Config update failed:', error);
            throw error;
        }
    }
}

exports default Config;