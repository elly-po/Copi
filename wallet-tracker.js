const HeliusClient = require('./helius-client');
const Database = require('./database');
const EventEmitter = require('events');

class WalletTracker extends EventEmitter {
  constructor() {
    super();
    this.db = Database;
    this.helius = new HeliusClient();
    this.trackedWallets = new Map();
  }

  async start() {
    console.log('🚀 [start] Starting wallet tracker...');

    await this.loadTrackedWallets();
    await this.helius.start();

    this.helius.on('tradeSignal', async (signal) => {
      const walletData = this.trackedWallets.get(signal.alphaWallet);
      if (!walletData) {
        console.log(`❌ [tradeSignal] Received signal from untracked wallet: ${signal.alphaWallet}`);
        return;
      }

      const isMemecoin = await this.isMemecoinTrade(signal.tokenAddress);
      if (!isMemecoin) {
        console.log(`🚫 [tradeSignal] Skipping non-memecoin trade: ${signal.tokenSymbol}`);
        return;
      }

      console.log(`📡 [tradeSignal] Emitting signal for ${signal.tokenSymbol}`);
      this.emit('tradeSignal', signal);
    });

    console.log(`👀 [start] Streaming ${this.trackedWallets.size} wallets from Helius`);
  }

  async stop() {
    await this.helius.stop();
    console.log('🛑 [stop] Wallet tracker stopped');
  }

  async loadTrackedWallets() {
    const wallets = await this.db.getTrackedWallets();
    this.trackedWallets.clear();

    for (const wallet of wallets) {
      this.trackedWallets.set(wallet.wallet_address, wallet);
      await this.helius.addWallet(wallet.wallet_address);
    }

    console.log(`📥 [loadTrackedWallets] Loaded ${wallets.length} wallets`);
  }

  async addWallet(address, name) {
    await this.db.addTrackedWallet(address, name);
    this.trackedWallets.set(address, { name });
    await this.helius.addWallet(address);

    console.log(`➕ [addWallet] Added wallet ${name} (${address}) to tracking`);
  }

  async isMemecoinTrade(tokenAddress) {
    const meta = await this.helius.getTokenMetadata(tokenAddress);
    return meta?.symbol && !['USDC','USDT','BTC','ETH','SOL'].includes(meta.symbol) &&
           meta.supply && parseFloat(meta.supply) > 1_000_000;
  }

  getTrackedWallets() {
    return Array.from(this.trackedWallets.entries()).map(([address, info]) => ({
      address,
      ...info
    }));
  }
}