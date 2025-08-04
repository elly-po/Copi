const WebSocket = require('ws');
const { Connection, PublicKey } = require('@solana/web3.js');
const EventEmitter = require('events');
const config = require('../config/config');
const database = require('../database/database');

class BlockchainMonitor extends EventEmitter {
    constructor() {
        super();
        this.connection = null;
        this.wsConnection = null;
        this.monitoredWallets = new Set();
        this.isMonitoring = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000;
        this.subscriptions = new Map();
        
        this.initializeConnections();
    }

    async initializeConnections() {
        try {
            const configData = await config.get();
            
            // Initialize RPC connection
            this.connection = new Connection(
                configData.solana.rpcUrl,
                configData.solana.commitment
            );
            
            console.log('✅ Blockchain monitor initialized');
        } catch (error) {
            console.error('❌ Failed to initialize blockchain monitor:', error);
            throw error;
        }
    }

    // Start monitoring alpha wallets
    async startMonitoring() {
        if (this.isMonitoring) {
            console.log('⚠️ Monitor already running');
            return;
        }

        try {
            await this.loadMonitoredWallets();
            await this.connectWebSocket();
            this.isMonitoring = true;
            console.log('🚀 Blockchain monitoring started');
            
            // Subscribe to wallets
            for (const wallet of this.monitoredWallets) {
                await this.subscribeToWallet(wallet);
            }
            
        } catch (error) {
            console.error('❌ Failed to start monitoring:', error);
            this.isMonitoring = false;
        }
    }

    async stopMonitoring() {
        this.isMonitoring = false;
        
        // Unsubscribe from all wallets
        for (const [wallet, subscriptionId] of this.subscriptions) {
            try {
                if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
                    await this.unsubscribeFromWallet(wallet, subscriptionId);
                }
            } catch (error) {
                console.error('Error unsubscribing from wallet:', wallet, error);
            }
        }
        
        this.subscriptions.clear();
        
        if (this.wsConnection) {
            this.wsConnection.close();
            this.wsConnection = null;
        }
        
        console.log('🛑 Blockchain monitoring stopped');
    }

    // Load monitored wallets from database
    async loadMonitoredWallets() {
        try {
            const alphaWallets = await database.getAllActiveAlphaWallets();
            this.monitoredWallets.clear();
            
            alphaWallets.forEach(wallet => {
                this.monitoredWallets.add(wallet.address);
            });
            
            console.log(`📊 Loaded ${this.monitoredWallets.size} alpha wallets to monitor`);
        } catch (error) {
            console.error('Error loading monitored wallets:', error);
        }
    }

    // Add wallet to monitoring
    async addWalletToMonitor(walletAddress) {
        if (!this.monitoredWallets.has(walletAddress)) {
            this.monitoredWallets.add(walletAddress);
            
            if (this.isMonitoring) {
                await this.subscribeToWallet(walletAddress);
            }
            
            console.log(`➕ Added wallet to monitor: ${walletAddress}`);
        }
    }

    // Remove wallet from monitoring
    async removeWalletFromMonitor(walletAddress) {
        if (this.monitoredWallets.has(walletAddress)) {
            this.monitoredWallets.delete(walletAddress);
            
            const subscriptionId = this.subscriptions.get(walletAddress);
            if (subscriptionId && this.isMonitoring) {
                await this.unsubscribeFromWallet(walletAddress, subscriptionId);
            }
            
            console.log(`➖ Removed wallet from monitor: ${walletAddress}`);
        }
    }

    // Connect to Helius WebSocket
    async connectWebSocket() {
        try {
            const configData = await config.get();
            
            if (this.wsConnection) {
                this.wsConnection.close();
            }
            
            this.wsConnection = new WebSocket(configData.solana.wsUrl);
            
            this.wsConnection.on('open', () => {
                console.log('🔌 WebSocket connected to Helius');
                this.reconnectAttempts = 0;
            });
            
            this.wsConnection.on('message', (data) => {
                this.handleWebSocketMessage(data);
            });
            
            this.wsConnection.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
            });
            
            this.wsConnection.on('close', () => {
                console.log('🔌 WebSocket connection closed');
                if (this.isMonitoring) {
                    this.handleReconnect();
                }
            });
            
        } catch (error) {
            console.error('Error connecting to WebSocket:', error);
            throw error;
        }
    }

    // Handle WebSocket reconnection
    async handleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ Max reconnection attempts reached');
            this.emit('error', new Error('Max reconnection attempts reached'));
            return;
        }
        
        this.reconnectAttempts++;
        console.log(`🔄 Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(async () => {
            try {
                await this.connectWebSocket();
                
                // Re-subscribe to all wallets
                for (const wallet of this.monitoredWallets) {
                    await this.subscribeToWallet(wallet);
                }
            } catch (error) {
                console.error('Reconnection failed:', error);
                this.handleReconnect();
            }
        }, this.reconnectDelay * this.reconnectAttempts);
    }

    // Subscribe to wallet transactions
    async subscribeToWallet(walletAddress) {
        if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
            console.log('⚠️ WebSocket not ready, skipping subscription for:', walletAddress);
            return;
        }

        try {
            const subscribeMsg = {
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'logsSubscribe',
                params: [
                    {
                        mentions: [walletAddress]
                    },
                    {
                        commitment: 'confirmed'
                    }
                ]
            };
            
            this.wsConnection.send(JSON.stringify(subscribeMsg));
            console.log(`👀 Subscribed to wallet: ${walletAddress}`);
            
        } catch (error) {
            console.error('Error subscribing to wallet:', walletAddress, error);
        }
    }

    // Unsubscribe from wallet
    async unsubscribeFromWallet(walletAddress, subscriptionId) {
        if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            const unsubscribeMsg = {
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'logsUnsubscribe',
                params: [subscriptionId]
            };
            
            this.wsConnection.send(JSON.stringify(unsubscribeMsg));
            this.subscriptions.delete(walletAddress);
            console.log(`👋 Unsubscribed from wallet: ${walletAddress}`);
            
        } catch (error) {
            console.error('Error unubscribing from wallet:', error);
        }
    }

    // Handle incoming WebSocket messages
    handleWebSocketMessage(data) {
        try {
            const message = JSON.parse(data.toString());
            
            // Handle subscription confirmations
            if (message.result && typeof message.result === 'number') {
                // This is a subscription ID - we could store it for unsubscribing
                return;
            }
            
            // Handle transaction notifications
            if (message.method === 'logsNotification' && message.params) {
                this.processTransactionNotification(message.params);
            }
            
        } catch (error) {
            console.error('Error handling WebSocket message:', error);
        }
    }

    // Process transaction notification
    async processTransactionNotification(params) {
        try {
            const { result } = params;
            const { signature, logs } = result.value;
            
            // Get full transaction details
            const transaction = await this.getTransactionDetails(signature);
            
            if (transaction && this.isSwapTransaction(transaction, logs)) {
                const swapData = await this.parseSwapTransaction(transaction);
                
                if (swapData) {
                    console.log('🔥 Detected swap:', swapData);
                    this.emit('swapDetected', swapData);
                }
            }
            
        } catch (error) {
            console.error('Error processing transaction notification:', error);
        }
    }

    // Get full transaction details
    async getTransactionDetails(signature) {
        try {
            const transaction = await this.connection.getParsedTransaction(
                signature,
                {
                    commitment: 'confirmed',
                    maxSupportedTransactionVersion: 0
                }
            );
            
            return transaction;
        } catch (error) {
            console.error('Error getting transaction details:', error);
            return null;
        }
    }

    // Check if transaction is a swap
    isSwapTransaction(transaction, logs) {
        if (!transaction || !logs) return false;
        
        // Look for common DEX program IDs in logs or instruction programs
        const dexPrograms = [
            'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter
            '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', // Raydium
            '22Y43yTVxuUkoRKdm9thyRhQ3SdgQS7c7kB6UNCiaczD', // Serum
        ];
        
        const logString = logs.join(' ');
        const hasSwapKeywords = logString.includes('swap') || 
                               logString.includes('trade') || 
                               logString.includes('exchange');
        
        const hasDexProgram = dexPrograms.some(program => 
            logString.includes(program)
        );
        
        return hasSwapKeywords || hasDexProgram;
    }

    // Parse swap transaction details
    async parseSwapTransaction(transaction) {
        try {
            if (!transaction || !transaction.meta) return null;
            
            const { meta, transaction: txData } = transaction;
            const { preTokenBalances, postTokenBalances } = meta;
            
            // Find the wallet that made the swap
            const walletAddress = this.findSwapWallet(transaction);
            if (!walletAddress || !this.monitoredWallets.has(walletAddress)) {
                return null;
            }
            
            // Analyze token balance changes
            const tokenChanges = this.analyzeTokenChanges(
                preTokenBalances || [],
                postTokenBalances || [],
                walletAddress
            );
            
            if (tokenChanges.length === 0) return null;
            
            return {
                signature: transaction.transaction?.signatures?.[0],
                wallet: walletAddress,
                blockTime: transaction.blockTime,
                slot: transaction.slot,
                fee: meta.fee,
                tokenChanges,
                type: this.determineSwapType(tokenChanges),
                inputToken: tokenChanges.find(t => t.change < 0),
                outputToken: tokenChanges.find(t => t.change > 0)
            };
            
        } catch (error) {
            console.error('Error parsing swap transaction:', error);
            return null;
        }
    }

    // Find which monitored wallet made the swap
    findSwapWallet(transaction) {
        try {
            const accountKeys = transaction.transaction?.message?.accountKeys || [];
            
            for (const key of accountKeys) {
                const pubkey = typeof key === 'string' ? key : key.pubkey;
                if (this.monitoredWallets.has(pubkey)) {
                    return pubkey;
                }
            }
            
            return null;
        } catch (error) {
            console.error('Error finding swap wallet:', error);
            return null;
        }
    }

    // Analyze token balance changes
    analyzeTokenChanges(preBalances, postBalances, walletAddress) {
        const changes = [];
        
        try {
            // Create maps for easier lookup
            const preMap = new Map();
            const postMap = new Map();
            
            preBalances.forEach(balance => {
                if (balance.owner === walletAddress) {
                    preMap.set(balance.mint, balance);
                }
            });
            
            postBalances.forEach(balance => {
                if (balance.owner === walletAddress) {
                    postMap.set(balance.mint, balance);
                }
            });
            
            // Find all mints that changed
            const allMints = new Set([...preMap.keys(), ...postMap.keys()]);
            
            allMints.forEach(mint => {
                const preBal = preMap.get(mint);
                const postBal = postMap.get(mint);
                
                const preAmount = preBal ? parseFloat(preBal.uiTokenAmount.uiAmount || 0) : 0;
                const postAmount = postBal ? parseFloat(postBal.uiTokenAmount.uiAmount || 0) : 0;
                
                const change = postAmount - preAmount;
                
                if (Math.abs(change) > 0.000001) { // Ignore dust changes
                    changes.push({
                        mint,
                        preAmount,
                        postAmount,
                        change,
                        decimals: postBal?.uiTokenAmount?.decimals || preBal?.uiTokenAmount?.decimals || 9
                    });
                }
            });
            
            return changes;
        } catch (error) {
            console.error('Error analyzing token changes:', error);
            return [];
        }
    }

    // Determine if it's a buy or sell
    determineSwapType(tokenChanges) {
        const solMint = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
        
        const solChange = tokenChanges.find(change => change.mint === solMint);
        
        if (solChange) {
            return solChange.change > 0 ? 'sell' : 'buy';
        }
        
        // If no SOL involved, check for common stablecoins
        const stablecoins = [
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
            'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
        ];
        
        const stablecoinChange = tokenChanges.find(change => 
            stablecoins.includes(change.mint)
        );
        
        if (stablecoinChange) {
            return stablecoinChange.change > 0 ? 'sell' : 'buy';
        }
        
        return 'swap'; // Generic swap if can't determine
    }

    // Get monitoring status
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            monitoredWallets: this.monitoredWallets.size,
            wsConnected: this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN,
            subscriptions: this.subscriptions.size
        };
    }
}

module.exports = new BlockchainMonitor();