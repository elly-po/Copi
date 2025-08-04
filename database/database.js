const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class Database {
    constructor() {
        this.dataDir = path.join(__dirname, '..', 'data');
        this.usersPath = path.join(this.dataDir, 'users.json');
        this.alphaWalletsPath = path.join(this.dataDir, 'alpha_wallets.json');
        this.tradesPath = path.join(this.dataDir, 'trades.json');
        this.rateLimitPath = path.join(this.dataDir, 'rate_limits.json');
        
        this.initializeDatabase();
    }

    async initializeDatabase() {
        try {
            await fs.ensureDir(this.dataDir);
            
            // Initialize empty files if they don't exist
            const files = [
                { path: this.usersPath, data: {} },
                { path: this.alphaWalletsPath, data: {} },
                { path: this.tradesPath, data: [] },
                { path: this.rateLimitPath, data: {} }
            ];

            for (const file of files) {
                if (!await fs.pathExists(file.path)) {
                    await fs.writeJson(file.path, file.data, { spaces: 2 });
                }
            }
        } catch (error) {
            console.error('Database initialization error:', error);
        }
    }

    // User management
    async getUser(telegramId) {
        try {
            const users = await fs.readJson(this.usersPath);
            return users[telegramId] || null;
        } catch (error) {
            console.error('Error getting user:', error);
            return null;
        }
    }

    async createUser(telegramId, userData) {
        try {
            const users = await fs.readJson(this.usersPath);
            users[telegramId] = {
                id: telegramId,
                createdAt: Date.now(),
                isActive: true,
                settings: {
                    tradeAmount: 0.01, // SOL
                    slippage: 3, // %
                    autoMimic: true,
                    buyOnly: false,
                    sellOnly: false,
                    delay: 1000, // ms
                    maxTradesPerToken: 3
                },
                wallet: null,
                alphaWallets: [],
                totalTrades: 0,
                totalPnL: 0,
                ...userData
            };
            
            await fs.writeJson(this.usersPath, users, { spaces: 2 });
            return users[telegramId];
        } catch (error) {
            console.error('Error creating user:', error);
            throw error;
        }
    }

    async updateUser(telegramId, updates) {
        try {
            const users = await fs.readJson(this.usersPath);
            if (!users[telegramId]) {
                throw new Error('User not found');
            }
            
            users[telegramId] = { ...users[telegramId], ...updates, updatedAt: Date.now() };
            await fs.writeJson(this.usersPath, users, { spaces: 2 });
            return users[telegramId];
        } catch (error) {
            console.error('Error updating user:', error);
            throw error;
        }
    }

    async getAllUsers() {
        try {
            const users = await fs.readJson(this.usersPath);
            return Object.values(users).filter(user => user.isActive);
        } catch (error) {
            console.error('Error getting all users:', error);
            return [];
        }
    }

    // Alpha wallet management
    async addAlphaWallet(telegramId, walletAddress, label = '') {
        try {
            const users = await fs.readJson(this.usersPath);
            const alphaWallets = await fs.readJson(this.alphaWalletsPath);
            
            if (!users[telegramId]) {
                throw new Error('User not found');
            }

            const walletId = crypto.randomUUID();
            const walletData = {
                id: walletId,
                address: walletAddress,
                label,
                addedBy: telegramId,
                addedAt: Date.now(),
                isActive: true,
                totalTrades: 0,
                successfulTrades: 0
            };

            // Add to alpha wallets collection
            alphaWallets[walletId] = walletData;
            
            // Add to user's alpha wallets list
            if (!users[telegramId].alphaWallets) {
                users[telegramId].alphaWallets = [];
            }
            users[telegramId].alphaWallets.push(walletId);

            await fs.writeJson(this.alphaWalletsPath, alphaWallets, { spaces: 2 });
            await fs.writeJson(this.usersPath, users, { spaces: 2 });

            return walletData;
        } catch (error) {
            console.error('Error adding alpha wallet:', error);
            throw error;
        }
    }

    async getAlphaWallets(telegramId) {
        try {
            const users = await fs.readJson(this.usersPath);
            const alphaWallets = await fs.readJson(this.alphaWalletsPath);
            
            const user = users[telegramId];
            if (!user || !user.alphaWallets) {
                return [];
            }

            return user.alphaWallets
                .map(walletId => alphaWallets[walletId])
                .filter(wallet => wallet && wallet.isActive);
        } catch (error) {
            console.error('Error getting alpha wallets:', error);
            return [];
        }
    }

    async getAllActiveAlphaWallets() {
        try {
            const alphaWallets = await fs.readJson(this.alphaWalletsPath);
            return Object.values(alphaWallets).filter(wallet => wallet.isActive);
        } catch (error) {
            console.error('Error getting all alpha wallets:', error);
            return [];
        }
    }

    async removeAlphaWallet(telegramId, walletId) {
        try {
            const users = await fs.readJson(this.usersPath);
            const alphaWallets = await fs.readJson(this.alphaWalletsPath);
            
            if (alphaWallets[walletId]) {
                alphaWallets[walletId].isActive = false;
                alphaWallets[walletId].removedAt = Date.now();
            }

            if (users[telegramId] && users[telegramId].alphaWallets) {
                users[telegramId].alphaWallets = users[telegramId].alphaWallets
                    .filter(id => id !== walletId);
            }

            await fs.writeJson(this.alphaWalletsPath, alphaWallets, { spaces: 2 });
            await fs.writeJson(this.usersPath, users, { spaces: 2 });

            return true;
        } catch (error) {
            console.error('Error removing alpha wallet:', error);
            throw error;
        }
    }

    // Trade logging
    async logTrade(tradeData) {
        try {
            const trades = await fs.readJson(this.tradesPath);
            const trade = {
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                ...tradeData
            };
            
            trades.push(trade);
            
            // Keep only last 10000 trades to prevent file from growing too large
            if (trades.length > 10000) {
                trades.splice(0, trades.length - 10000);
            }
            
            await fs.writeJson(this.tradesPath, trades, { spaces: 2 });
            return trade;
        } catch (error) {
            console.error('Error logging trade:', error);
            throw error;
        }
    }

    async getUserTrades(telegramId, limit = 50) {
        try {
            const trades = await fs.readJson(this.tradesPath);
            return trades
                .filter(trade => trade.userId === telegramId)
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, limit);
        } catch (error) {
            console.error('Error getting user trades:', error);
            return [];
        }
    }

    // Rate limiting
    async checkRateLimit(telegramId, action = 'general') {
        try {
            const rateLimits = await fs.readJson(this.rateLimitPath);
            const key = `${telegramId}_${action}`;
            const now = Date.now();
            const windowMs = 60000; // 1 minute
            const maxRequests = 30;

            if (!rateLimits[key]) {
                rateLimits[key] = { count: 1, resetTime: now + windowMs };
                await fs.writeJson(this.rateLimitPath, rateLimits, { spaces: 2 });
                return true;
            }

            if (now > rateLimits[key].resetTime) {
                rateLimits[key] = { count: 1, resetTime: now + windowMs };
                await fs.writeJson(this.rateLimitPath, rateLimits, { spaces: 2 });
                return true;
            }

            if (rateLimits[key].count >= maxRequests) {
                return false;
            }

            rateLimits[key].count++;
            await fs.writeJson(this.rateLimitPath, rateLimits, { spaces: 2 });
            return true;
        } catch (error) {
            console.error('Error checking rate limit:', error);
            return true; // Allow on error
        }
    }

    // Cleanup old data
    async cleanup() {
        try {
            const rateLimits = await fs.readJson(this.rateLimitPath);
            const now = Date.now();
            
            // Remove expired rate limit entries
            Object.keys(rateLimits).forEach(key => {
                if (now > rateLimits[key].resetTime) {
                    delete rateLimits[key];
                }
            });
            
            await fs.writeJson(this.rateLimitPath, rateLimits, { spaces: 2 });
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }
}

module.exports = new Database();