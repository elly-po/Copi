const { Connection, PublicKey } = require('@solana/web3.js');
const EventEmitter = require('events');
const config = require('../config/config.js');
const database = require('../database/database.js');
const { parseSwapTransaction } = require('../utils/transactionParser.js');
const rateLimiter = require('../utils/rateLimiter.js');

class BlockchainMonitor extends EventEmitter {
    constructor() {
        super();
        this.connection = null;
        this.monitoredWallets = new Set();
        this.isMonitoring = false;
        this.pollInterval = 15000; // 15 seconds to stay under free tier limits
        this.pollTimer = null;
        this.lastSignatures = new Map(); // Track last seen TX per wallet
        
        this.initializeConnection();
    }

    async initializeConnection() {
        try {
            const configData = await config.get();
            this.connection = new Connection(
                configData.solana.rpcUrl,
                configData.solana.commitment
            );
            console.log('✅ Blockchain monitor initialized (RPC polling mode)');
        } catch (error) {
            console.error('❌ Failed to initialize blockchain monitor:', error);
            throw error;
        }
    }

    async startMonitoring() {
        if (this.isMonitoring) {
            console.log('⚠️ Monitor already running');
            return;
        }

        try {
            await this.loadMonitoredWallets();
            this.isMonitoring = true;
            this.pollTimer = setInterval(() => this.pollWallets(), this.pollInterval);
            console.log(`🚀 Started polling ${this.monitoredWallets.size} wallets every ${this.pollInterval/1000}s`);
        } catch (error) {
            console.error('❌ Failed to start monitoring:', error);
            this.isMonitoring = false;
        }
    }

    async stopMonitoring() {
        this.isMonitoring = false;
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = null;
        console.log('🛑 Blockchain monitoring stopped');
    }

    async loadMonitoredWallets() {
        try {
            const alphaWallets = await database.getAllActiveAlphaWallets();
            this.monitoredWallets.clear();
            
            alphaWallets.forEach(wallet => {
                this.monitoredWallets.add(wallet.address);
                this.lastSignatures.set(wallet.address, null); // Initialize tracking
            });
            
            console.log(`📊 Loaded ${this.monitoredWallets.size} alpha wallets to monitor`);
        } catch (error) {
            console.error('Error loading monitored wallets:', error);
        }
    }

    async pollWallets() {
        if (!this.isMonitoring) return;

        for (const walletAddress of this.monitoredWallets) {
            try {
                await rateLimiter.check('helius-rpc');
                const signatures = await this.connection.getSignaturesForAddress(
                    new PublicKey(walletAddress),
                    { limit: 3 } // Minimal fetch for free tier
                );

                const newTxs = signatures.filter(sig => 
                    sig.signature !== this.lastSignatures.get(walletAddress)
                );

                if (newTxs.length > 0) {
                    this.lastSignatures.set(walletAddress, newTxs[0].signature);
                    await this.processNewTransactions(walletAddress, newTxs);
                }
            } catch (error) {
                console.error(`Polling failed for ${walletAddress}:`, error);
                // Implement exponential backoff if needed
            }
        }
    }

    async processNewTransactions(walletAddress, transactions) {
        for (const tx of transactions) {
            try {
                await rateLimiter.check('helius-rpc');
                const parsedTx = await this.connection.getParsedTransaction(
                    tx.signature,
                    { maxSupportedTransactionVersion: 0 }
                );

                const swapDetails = await parseSwapTransaction(parsedTx);
                if (swapDetails && this.isValidSwap(swapDetails)) {
                    this.emit('swap-detected', {
                        wallet: walletAddress,
                        txSignature: tx.signature,
                        timestamp: tx.blockTime,
                        ...swapDetails
                    });
                }
            } catch (error) {
                console.error(`Failed to process TX ${tx.signature}:`, error);
            }
        }
    }

    isValidSwap(swapDetails) {
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
            this.lastSignatures.set(walletAddress, null);
            
            if (this.isMonitoring) {
                console.log(`➕ Added wallet to polling: ${walletAddress}`);
            }
        }
    }

    async removeWalletFromMonitor(walletAddress) {
        if (this.monitoredWallets.has(walletAddress)) {
            this.monitoredWallets.delete(walletAddress);
            this.lastSignatures.delete(walletAddress);
            console.log(`➖ Removed wallet from monitoring: ${walletAddress}`);
        }
    }
}

module.exports = new BlockchainMonitor();
