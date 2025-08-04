const WebSocket = require('ws');
const { Connection, PublicKey, Transaction } = require('@solana/web3.js');
const EventEmitter = require('events');
const config = require('../config/config');
const database = require('../database/database');
const walletManager = require('../wallet/walletManager');
const { parseSwapTransaction } = require('../utils/transactionParser');

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
        this.pingInterval = 30000;
        this.pingTimeout = null;
        
        this.initializeConnections();
    }

    async initializeConnections() {
        try {
            const configData = await config.get();
            
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

    async connectWebSocket() {
        const configData = await config.get();
        
        if (this.wsConnection) {
            this.wsConnection.close();
        }

        this.wsConnection = new WebSocket(configData.solana.wsUrl);

        this.wsConnection.on('open', () => {
            console.log('🔌 WebSocket connected to Helius');
            this.reconnectAttempts = 0;
            this.setupPing();
            this.emit('ws-connected');
        });

        this.wsConnection.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                this.handleWebSocketMessage(message);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        });

        this.wsConnection.on('close', () => {
            console.log('🔴 WebSocket disconnected');
            clearTimeout(this.pingTimeout);
            this.handleReconnect();
        });

        this.wsConnection.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
    }

    setupPing() {
        this.pingTimeout = setTimeout(() => {
            if (this.wsConnection.readyState === WebSocket.OPEN) {
                this.wsConnection.ping();
                this.setupPing();
            }
        }, this.pingInterval);
    }

    async handleReconnect() {
        if (!this.isMonitoring || this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('Max reconnection attempts reached, stopping monitor');
            this.isMonitoring = false;
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`Reconnecting attempt ${this.reconnectAttempts} in ${delay}ms...`);
        
        setTimeout(async () => {
            try {
                await this.connectWebSocket();
                if (this.wsConnection.readyState === WebSocket.OPEN) {
                    await this.resubscribeAll();
                }
            } catch (error) {
                console.error('Reconnection failed:', error);
                this.handleReconnect();
            }
        }, delay);
    }

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
        } catch (error) {
            console.error('❌ Failed to start monitoring:', error);
            this.isMonitoring = false;
        }
    }

    async stopMonitoring() {
        this.isMonitoring = false;
        
        if (this.wsConnection) {
            this.wsConnection.close();
            this.wsConnection = null;
        }
        
        clearTimeout(this.pingTimeout);
        console.log('🛑 Blockchain monitoring stopped');
    }

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

    async subscribeToWallet(walletAddress) {
        if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not connected');
        }

        if (!walletManager.isValidWalletAddress(walletAddress)) {
            throw new Error(`Invalid wallet address: ${walletAddress}`);
        }

        try {
            const subscriptionMessage = {
                jsonrpc: "2.0",
                id: 1,
                method: "accountSubscribe",
                params: [
                    walletAddress,
                    {
                        encoding: "jsonParsed",
                        commitment: "confirmed"
                    }
                ]
            };

            this.wsConnection.send(JSON.stringify(subscriptionMessage));
            console.log(`👁️ Subscribed to wallet: ${walletAddress}`);
        } catch (error) {
            console.error(`Error subscribing to wallet ${walletAddress}:`, error);
            throw error;
        }
    }

    async resubscribeAll() {
        console.log('Resubscribing to all monitored wallets...');
        for (const wallet of this.monitoredWallets) {
            try {
                await this.subscribeToWallet(wallet);
            } catch (error) {
                console.error(`Failed to resubscribe to ${wallet}:`, error);
            }
        }
    }

    async handleWebSocketMessage(message) {
        try {
            // Handle subscription responses
            if (message.result) {
                return; // Subscription confirmation
            }

            // Handle account changes
            if (message.params?.result?.value) {
                const accountInfo = message.params.result.value;
                const walletAddress = message.params.result.value.pubkey;
                
                if (this.monitoredWallets.has(walletAddress)) {
                    await this.processWalletActivity(walletAddress, accountInfo);
                }
            }
        } catch (error) {
            console.error('Error handling WebSocket message:', error);
        }
    }

    async processWalletActivity(walletAddress, accountInfo) {
        try {
            // Get recent transactions
            const transactions = await walletManager.getRecentSwaps(walletAddress, 5);
            
            for (const tx of transactions) {
                const swapDetails = await parseSwapTransaction(tx.signature);
                
                if (swapDetails && this.isValidSwap(swapDetails)) {
                    this.emit('swap-detected', {
                        wallet: walletAddress,
                        txSignature: tx.signature,
                        timestamp: tx.blockTime,
                        ...swapDetails
                    });
                }
            }
        } catch (error) {
            console.error(`Error processing activity for ${walletAddress}:`, error);
        }
    }

    isValidSwap(swapDetails) {
        // Basic validation - expand with your criteria
        return (
            swapDetails &&
            swapDetails.inputMint &&
            swapDetails.outputMint &&
            swapDetails.inputAmount > 0 &&
            swapDetails.outputAmount > 0
        );
    }

    async addWalletToMonitor(walletAddress) {
        if (!this.monitoredWallets.has(walletAddress)) {
            this.monitoredWallets.add(walletAddress);
            
            if (this.isMonitoring && this.wsConnection?.readyState === WebSocket.OPEN) {
                await this.subscribeToWallet(walletAddress);
            }
            
            console.log(`➕ Added wallet to monitor: ${walletAddress}`);
        }
    }

    async removeWalletFromMonitor(walletAddress) {
        if (this.monitoredWallets.has(walletAddress)) {
            this.monitoredWallets.delete(walletAddress);
            console.log(`➖ Removed wallet from monitor: ${walletAddress}`);
        }
    }
}

module.exports = new BlockchainMonitor();
