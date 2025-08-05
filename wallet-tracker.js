const HeliusClient = require('./helius-client');
const Database = require('./database');
const EventEmitter = require('events');

class WalletTracker extends EventEmitter {
  constructor() {
    super();
    this.helius = new HeliusClient();
    this.db = Database;
    this.tracking = false;
    this.trackedWallets = new Map();
    this.lastSignatures = new Map();
    this.pollingInterval = parseInt(process.env.POLLING_INTERVAL) || 30000;
  }

  async start() {
    if (this.tracking) return;
    
    console.log('🚀 [start] Starting wallet tracker...');
    this.tracking = true;
    
    // Load tracked wallets from database
    await this.loadTrackedWallets();
    
    // Start polling
    this.poll();
    
    console.log(`📡 [start] Tracking ${this.trackedWallets.size} wallets with ${this.pollingInterval}ms interval`);
  }

  async stop() {
    this.tracking = false;
    console.log('🛑 [stop] Wallet tracker stopped');
  }

  async loadTrackedWallets() {
    try {
      const wallets = await this.db.getTrackedWallets();
      this.trackedWallets.clear();

      console.log(`📥 [loadTrackedWallets] Loaded ${wallets.length} wallets from DB`);
      
      for (const wallet of wallets) {
        this.trackedWallets.set(wallet.wallet_address, {
          name: wallet.name,
          successRate: wallet.success_rate,
          totalTrades: wallet.total_trades
        });
        console.log(`  • [wallet] ${wallet.name} => ${wallet.wallet_address}`);
      }
    } catch (error) {
      console.error('❌ [loadTrackedWallets] Failed:', error.message);
    }
  }

  async poll() {
    if (!this.tracking) return;

    console.log('🔁 [poll] Polling all wallets for activity...');

    try {
      const promises = Array.from(this.trackedWallets.keys()).map(address => 
        this.checkWalletActivity(address)
      );
      
      await Promise.allSettled(promises);
    } catch (error) {
      console.error('❌ [poll] Error during polling:', error.message);
    }

    console.log('✅ [poll] Polling cycle complete');

    // Schedule next poll
    setTimeout(() => this.poll(), this.pollingInterval);
  }

  async checkWalletActivity(walletAddress) {
    console.log(`🔍 [checkWalletActivity] Checking wallet: ${walletAddress}`);

    try {
      const transactions = await this.helius.getTransactions(walletAddress, null, 5);
      
      if (!transactions || transactions.length === 0) {
        console.log(`📭 [checkWalletActivity] No transactions found for ${walletAddress}`);
        return;
      }

      console.log(`📦 [checkWalletActivity] Got ${transactions.length} transactions for ${walletAddress}`);

      const lastSig = this.lastSignatures.get(walletAddress);
      const newTransactions = lastSig 
        ? transactions.filter(tx => tx.signature !== lastSig && tx.timestamp > Date.now() - 300000)
        : transactions.slice(0, 1);

      if (newTransactions.length > 0) {
        this.lastSignatures.set(walletAddress, newTransactions[0].signature);
        
        console.log(`✨ [checkWalletActivity] Found ${newTransactions.length} new transaction(s) for ${walletAddress}`);
        
        for (const tx of newTransactions) {
          await this.analyzeTransaction(walletAddress, tx);
        }
      } else {
        console.log(`⏸️ [checkWalletActivity] No new relevant transactions for ${walletAddress}`);
      }
    } catch (error) {
      console.error(`❌ [checkWalletActivity] Error for ${walletAddress}:`, error.message);
    }
  }

  async analyzeTransaction(walletAddress, transaction) {
    console.log(`🔎 [analyzeTransaction] Analyzing txn ${transaction.signature} for ${walletAddress}`);

    try {
      const swapData = this.helius.parseSwapTransaction(transaction);
      
      if (!swapData || !swapData.tokenIn || !swapData.tokenOut) {
        console.log(`⚠️ [analyzeTransaction] Not a swap txn: ${transaction.signature}`);
        return;
      }

      const isMemecoinTrade = await this.isMemecoinTrade(swapData);
      
      if (!isMemecoinTrade) {
        console.log(`🚫 [analyzeTransaction] Skipping non-memecoin trade from ${walletAddress}`);
        return;
      }

      const tokenMetadata = await this.helius.getTokenMetadata(swapData.tokenOut);

      const tradeSignal = {
        alphaWallet: walletAddress,
        signature: transaction.signature,
        tokenAddress: swapData.tokenOut,
        tokenSymbol: tokenMetadata?.symbol || 'UNKNOWN',
        tokenName: tokenMetadata?.name || 'Unknown Token',
        tradeType: 'BUY',
        timestamp: transaction.timestamp,
        amountIn: swapData.amountIn,
        amountOut: swapData.amountOut,
        price: swapData.amountIn / swapData.amountOut
      };

      console.log(`📡 [analyzeTransaction] Emitting trade signal:`, tradeSignal);
      this.emit('tradeSignal', tradeSignal);
      
    } catch (error) {
      console.error(`❌ [analyzeTransaction] Failed for ${transaction.signature}:`, error.message);
    }
  }

  async isMemecoinTrade(swapData) {
    try {
      console.log(`[isMemecoinTrade] Checking if token is memecoin: ${swapData.tokenOut}`);

      const tokenMetadata = await this.helius.getTokenMetadata(swapData.tokenOut);
      
      if (!tokenMetadata) {
        console.log(`[isMemecoinTrade] No metadata for ${swapData.tokenOut}`);
        return false;
      }

      const isMemecoin = (
        tokenMetadata.symbol &&
        tokenMetadata.symbol.length <= 10 &&
        !['USDC', 'USDT', 'SOL', 'BTC', 'ETH'].includes(tokenMetadata.symbol) &&
        tokenMetadata.supply &&
        parseFloat(tokenMetadata.supply) > 1000000
      );

      console.log(`[isMemecoinTrade] Token ${tokenMetadata.symbol} is ${isMemecoin ? '' : 'NOT '}a memecoin`);
      return isMemecoin;

    } catch (error) {
      console.error(`❌ [isMemecoinTrade] Error:`, error.message);
      return false;
    }
  }

  async addWallet(address, name) {
    try {
      await this.db.addTrackedWallet(address, name);
      this.trackedWallets.set(address, {
        name,
        successRate: 0,
        totalTrades: 0
      });
      
      console.log(`➕ [addWallet] Added wallet ${name} (${address}) to tracking`);
      return true;
    } catch (error) {
      console.error(`❌ [addWallet] Failed to add wallet:`, error.message);
      return false;
    }
  }

  getTrackedWallets() {
    return Array.from(this.trackedWallets.entries()).map(([address, data]) => ({
      address,
      ...data
    }));
  }
}

module.exports = WalletTracker;
