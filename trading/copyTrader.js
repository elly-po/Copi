const EventEmitter = require('events');
const database = require('../database/database');
const walletManager = require('../wallet/walletManager');
const jupiterTrader = require('./jupiterTrader');
const { Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');

class CopyTrader extends EventEmitter {
    constructor() {
        super();
        this.tradeCounters = new Map(); // Track trades per token per user
        this.processingQueue = [];
        this.isProcessing = false;
        this.maxConcurrentTrades = 3;
        this.activeTrades = new Set();
    }

    // Process detected swap from alpha wallet
    async processAlphaSwap(swapData) {
        try {
            console.log(`🔥 Processing alpha swap from ${swapData.wallet}`);
            
            // Get all users tracking this alpha wallet
            const users = await this.getUsersTrackingWallet(swapData.wallet);
            
            if (users.length === 0) {
                console.log('⚠️ No users tracking this wallet');
                return;
            }

            console.log(`👥 ${users.length} users tracking this wallet`);

            // Queue copy trades for each user
            for (const user of users) {
                await this.queueCopyTrade(user, swapData);
            }

        } catch (error) {
            console.error('Error processing alpha swap:', error);
        }
    }

    // Get users tracking a specific alpha wallet
    async getUsersTrackingWallet(walletAddress) {
        try {
            const allUsers = await database.getAllUsers();
            const trackingUsers = [];

            for (const user of allUsers) {
                const alphaWallets = await database.getAlphaWallets(user.id);
                const isTracking = alphaWallets.some(wallet => 
                    wallet.address === walletAddress && wallet.isActive
                );
                
                if (isTracking && user.wallet && user.settings.autoMimic) {
                    trackingUsers.push(user);
                }
            }

            return trackingUsers;
        } catch (error) {
            console.error('Error getting users tracking wallet:', error);
            return [];
        }
    }

    // Queue a copy trade
    async queueCopyTrade(user, swapData) {
        try {
            // Check if user should copy this trade
            const shouldCopy = await this.shouldCopyTrade(user, swapData);
            
            if (!shouldCopy.allowed) {
                console.log(`⏭️ Skipping trade for user ${user.id}: ${shouldCopy.reason}`);
                return;
            }

            const copyTrade = {
                id: `${user.id}_${swapData.signature}_${Date.now()}`,
                userId: user.id,
                user,
                swapData,
                timestamp: Date.now(),
                status: 'queued'
            };

            this.processingQueue.push(copyTrade);
            console.log(`📝 Queued copy trade for user ${user.id}`);

            // Process queue if not already processing
            if (!this.isProcessing) {
                this.processQueue();
            }

        } catch (error) {
            console.error('Error queueing copy trade:', error);
        }
    }

    // Check if user should copy this trade
    async shouldCopyTrade(user, swapData) {
        try {
            const settings = user.settings;
            
            // Check if auto-mimic is enabled
            if (!settings.autoMimic) {
                return { allowed: false, reason: 'Auto-mimic disabled' };
            }

            // Check buy/sell only settings
            if (settings.buyOnly && swapData.type === 'sell') {
                return { allowed: false, reason: 'Buy-only mode enabled' };
            }
            
            if (settings.sellOnly && swapData.type === 'buy') {
                return { allowed: false, reason: 'Sell-only mode enabled' };
            }

            // Check trade counter for this token
            const tokenMint = swapData.type === 'buy' 
                ? swapData.outputToken?.mint 
                : swapData.inputToken?.mint;
                
            if (tokenMint) {
                const tradeKey = `${user.id}_${tokenMint}`;
                const currentCount = this.tradeCounters.get(tradeKey) || 0;
                
                if (currentCount >= settings.maxTradesPerToken) {
                    return { 
                        allowed: false, 
                        reason: `Max trades per token reached (${settings.maxTradesPerToken})` 
                    };
                }
            }

            // Check wallet balance
            if (!user.wallet || !user.wallet.publicKey) {
                return { allowed: false, reason: 'No wallet connected' };
            }

            const solBalance = await walletManager.getSOLBalance(user.wallet.publicKey);
            const requiredAmount = settings.tradeAmount + 0.01; // Trade amount + fees
            
            if (solBalance < requiredAmount) {
                return { 
                    allowed: false, 
                    reason: `Insufficient SOL balance: ${solBalance} < ${requiredAmount}` 
                };
            }

            return { allowed: true };

        } catch (error) {
            console.error('Error checking if should copy trade:', error);
            return { allowed: false, reason: 'Error checking conditions' };
        }
    }

    // Process the trade queue
    async processQueue() {
        if (this.isProcessing) return;
        
        this.isProcessing = true;
        
        try {
            while (this.processingQueue.length > 0 && this.activeTrades.size < this.maxConcurrentTrades) {
                const copyTrade = this.processingQueue.shift();
                
                if (copyTrade) {
                    // Execute trade without waiting (parallel processing)
                    this.executeCopyTrade(copyTrade)
                        .finally(() => {
                            this.activeTrades.delete(copyTrade.id);
                        });
                    
                    this.activeTrades.add(copyTrade.id);
                }
            }
        } catch (error) {
            console.error('Error processing queue:', error);
        } finally {
            this.isProcessing = false;
            
            // Continue processing if there are more trades
            if (this.processingQueue.length > 0) {
                setTimeout(() => this.processQueue(), 1000);
            }
        }
    }

    // Execute a copy trade
    async executeCopyTrade(copyTrade) {
        const { user, swapData } = copyTrade;
        
        try {
            console.log(`🚀 Executing copy trade for user ${user.id}`);
            
            // Apply delay if configured
            if (user.settings.delay > 0) {
                console.log(`⏰ Applying delay: ${user.settings.delay}ms`);
                await new Promise(resolve => setTimeout(resolve, user.settings.delay));
            }

            // Get user's keypair
            const userKeypair = this.getUserKeypair(user);
            if (!userKeypair) {
                throw new Error('Failed to get user keypair');
            }

            let tradeResult;
            
            if (swapData.type === 'buy') {
                tradeResult = await this.executeBuyTrade(user, swapData, userKeypair);
            } else if (swapData.type === 'sell') {
                tradeResult = await this.executeSellTrade(user, swapData, userKeypair);
            } else {
                throw new Error(`Unsupported trade type: ${swapData.type}`);
            }

            // Update trade counter
            if (tradeResult.success) {
                const tokenMint = swapData.type === 'buy' 
                    ? swapData.outputToken?.mint 
                    : swapData.inputToken?.mint;
                    
                if (tokenMint) {
                    const tradeKey = `${user.id}_${tokenMint}`;
                    const currentCount = this.tradeCounters.get(tradeKey) || 0;
                    this.tradeCounters.set(tradeKey, currentCount + 1);
                }
            }

            // Log the trade
            await database.logTrade({
                userId: user.id,
                alphaWallet: swapData.wallet,
                originalSignature: swapData.signature,
                copySignature: tradeResult.signature,
                type: swapData.type,
                inputMint: tradeResult.inputMint,
                outputMint: tradeResult.outputMint,
                inputAmount: tradeResult.inputAmount,
                outputAmount: tradeResult.outputAmount,
                success: tradeResult.success,
                error: tradeResult.error,
                priceImpact: tradeResult.priceImpact,
                fee: tradeResult.fee
            });

            // Emit trade completion event
            this.emit('tradeCompleted', {
                userId: user.id,
                tradeResult,
                swapData
            });

            console.log(`✅ Copy trade completed for user ${user.id}: ${tradeResult.success ? 'SUCCESS' : 'FAILED'}`);

        } catch (error) {
            console.error(`❌ Copy trade failed for user ${user.id}:`, error);
            
            // Log failed trade
            await database.logTrade({
                userId: user.id,
                alphaWallet: swapData.wallet,
                originalSignature: swapData.signature,
                copySignature: null,
                type: swapData.type,
                success: false,
                error: error.message
            });

            // Emit trade error event
            this.emit('tradeError', {
                userId: user.id,
                error: error.message,
                swapData
            });
        }
    }

    // Execute buy trade
    async executeBuyTrade(user, swapData, userKeypair) {
        try {
            const tokenMint = swapData.outputToken?.mint;
            if (!tokenMint) {
                throw new Error('No output token found in swap data');
            }

            console.log(`💰 Buying ${tokenMint} with ${user.settings.tradeAmount} SOL`);

            const result = await jupiterTrader.buyToken(
                tokenMint,
                user.settings.tradeAmount,
                userKeypair,
                user.settings.slippage * 100 // Convert to basis points
            );

            return result;

        } catch (error) {
            console.error('Error executing buy trade:', error);
            throw error;
        }
    }

    // Execute sell trade
    async executeSellTrade(user, swapData, userKeypair) {
        try {
            const tokenMint = swapData.inputToken?.mint;
            if (!tokenMint) {
                throw new Error('No input token found in swap data');
            }

            // Get user's token balance
            const tokenBalance = await walletManager.getTokenBalance(
                user.wallet.publicKey,
                tokenMint
            );

            if (!tokenBalance || tokenBalance.uiAmount <= 0) {
                throw new Error(`No ${tokenMint} balance to sell`);
            }

            // Calculate amount to sell (could be percentage or fixed amount)
            const amountToSell = this.calculateSellAmount(
                tokenBalance,
                user.settings,
                swapData
            );

            console.log(`💸 Selling ${amountToSell} of ${tokenMint}`);

            const result = await jupiterTrader.sellToken(
                tokenMint,
                amountToSell,
                userKeypair,
                user.settings.slippage * 100 // Convert to basis points
            );

            return result;

        } catch (error) {
            console.error('Error executing sell trade:', error);
            throw error;
        }
    }

    // Calculate sell amount based on strategy
    calculateSellAmount(tokenBalance, settings, swapData) {
        // For now, sell entire balance
        // Could be enhanced to sell percentage or match alpha wallet's sell ratio
        return tokenBalance.balance;
    }

    // Get user's keypair from encrypted storage
    getUserKeypair(user) {
        try {
            if (!user.wallet || !user.wallet.encryptedPrivateKey) {
                throw new Error('No wallet or private key found');
            }

            const config = require('../config/config');
            const configData = config.get();
            
            const decryptedKey = walletManager.decryptPrivateKey(
                user.wallet.encryptedPrivateKey,
                configData.security.encryptionKey
            );

            const wallet = walletManager.importWallet(decryptedKey);
            return wallet.keypair;

        } catch (error) {
            console.error('Error getting user keypair:', error);
            return null;
        }
    }

    // Reset trade counter for a token
    resetTradeCounter(userId, tokenMint) {
        const tradeKey = `${userId}_${tokenMint}`;
        this.tradeCounters.delete(tradeKey);
    }

    // Get trade counter for a token
    getTradeCounter(userId, tokenMint) {
        const tradeKey = `${userId}_${tokenMint}`;
        return this.tradeCounters.get(tradeKey) || 0;
    }

    // Clean up old trade counters (call periodically)
    cleanupTradeCounters() {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        
        // Reset all counters older than 24 hours
        // This is a simple implementation - could be enhanced with timestamps
        this.tradeCounters.clear();
        console.log('🧹 Trade counters cleaned up');
    }

    // Get copy trader status
    getStatus() {
        return {
            queueLength: this.processingQueue.length,
            activeTrades: this.activeTrades.size,
            maxConcurrentTrades: this.maxConcurrentTrades,
            isProcessing: this.isProcessing,
            tradeCounters: this.tradeCounters.size
        };
    }

    // Pause copy trading
    pause() {
        this.isProcessing = false;
        console.log('⏸️ Copy trading paused');
    }

    // Resume copy trading
    resume() {
        if (!this.isProcessing && this.processingQueue.length > 0) {
            this.processQueue();
            console.log('▶️ Copy trading resumed');
        }
    }

    // Stop all copy trading
    stop() {
        this.isProcessing = false;
        this.processingQueue.length = 0;
        this.activeTrades.clear();
        console.log('🛑 Copy trading stopped');
    }
}

module.exports = new CopyTrader();