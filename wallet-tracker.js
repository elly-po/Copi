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
    
    console.log('Starting wallet tracker...');
    this.tracking = true;
    
    // Load tracked wallets from database
    await this.loadTrackedWallets();
    
    // Start polling
    this.poll();
    
    console.log(`Tracking ${this.trackedWallets.size} wallets with ${this.pollingInterval}ms interval`);
  }

  async stop() {
    this.tracking = false;
    console.log('Wallet tracker stopped');
  }

  async loadTrackedWallets() {
    try {
      const wallets = await this.db.getTrackedWallets();
      this.trackedWallets.clear();
      
      for (const wallet of wallets) {
        this.trackedWallets.set(wallet.wallet_address, {
          name: wallet.name,
          successRate: wallet.success_rate,
          totalTrades: wallet.total_trades
        });
      }
    } catch (error) {
      console.error('Error loading tracked wallets:', error.message);
    }
  }

  async poll() {
    if (!this.tracking) return;

    try {
      const promises = Array.from(this.trackedWallets.keys()).map(address => 
        this.checkWalletActivity(address)
      );
      
      await Promise.allSettled(promises);
    } catch (error) {
      console.error('Error in polling cycle:', error.message);
    }

    // Schedule next poll
    setTimeout(() => this.poll(), this.pollingInterval);
  }

  async checkWalletActivity(walletAddress) {
    try {
      const transactions = await this.helius.getTransactions(walletAddress, null, 5);
      
      if (!transactions || transactions.length === 0) return;

      const lastSig = this.lastSignatures.get(walletAddress);
      const newTransactions = lastSig 
        ? transactions.filter(tx => tx.signature !== lastSig && tx.timestamp > Date.now() - 300000) // 5 minutes
        : transactions.slice(0, 1);

      if (newTransactions.length > 0) {
        this.lastSignatures.set(walletAddress, newTransactions[0].signature);
        
        for (const tx of newTransactions) {
          await this.analyzeTransaction(walletAddress, tx);
        }
      }
    } catch (error) {
      console.error(`Error checking wallet ${walletAddress}:`, error.message);
    }
  }

  async analyzeTransaction(walletAddress, transaction) {
    try {
      const swapData = this.helius.parseSwapTransaction(transaction);
      
      if (!swapData || !swapData.tokenIn || !swapData.tokenOut) return;

      // Check if it's a memecoin trade (not SOL -> USDC type trades)
      const isMemecoinTrade = await this.isMemecoinTrade(swapData);
      
      if (!isMemecoinTrade) return;

      // Get token metadata
      const tokenMetadata = await this.helius.getTokenMetadata(swapData.tokenOut);
      
      const tradeSignal = {
        alphaWallet: walletAddress,
        signature: transaction.signature,
        tokenAddress: swapData.tokenOut,
        tokenSymbol: tokenMetadata?.symbol || 'UNKNOWN',
        tokenName: tokenMetadata?.name || 'Unknown Token',
        tradeType: 'BUY', // Assuming most tracked trades are buys
        timestamp: transaction.timestamp,
        amountIn: swapData.amountIn,
        amountOut: swapData.amountOut,
        price: swapData.amountIn / swapData.amountOut
      };

      console.log(`🔥 Trade detected from ${walletAddress}:`, tradeSignal);
      
      // Emit trade signal for bot to process
      this.emit('tradeSignal', tradeSignal);
      
    } catch (error) {
      console.error('Error analyzing transaction:', error.message);
    }
  }

  async isMemecoinTrade(swapData) {
    try {
      // Basic heuristics to identify memecoin trades
      // You can enhance this with more sophisticated logic
      
      const tokenMetadata = await this.helius.getTokenMetadata(swapData.tokenOut);
      
      if (!tokenMetadata) return false;
      
      // Check for typical memecoin characteristics
      const isMemecoin = (
        tokenMetadata.symbol &&
        tokenMetadata.symbol.length <= 10 &&
        !['USDC', 'USDT', 'SOL', 'BTC', 'ETH'].includes(tokenMetadata.symbol) &&
        tokenMetadata.supply && 
        parseFloat(tokenMetadata.supply) > 1000000 // High supply typical of memecoins
      );
      
      return isMemecoin;
    } catch (error) {
      console.error('Error checking if memecoin trade:', error.message);
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
      
      console.log(`Added wallet ${name} (${address}) to tracking`);
      return true;
    } catch (error) {
      console.error('Error adding wallet:', error.message);
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
