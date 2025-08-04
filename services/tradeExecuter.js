const database = require('../database/database');
const jupiter = require('./jupiterService');
const blockchain = require('../blockchain/blockchainMonitor');
const { sleep } = require('../utils/helpers');

class TradeExecutor {
  constructor() {
    this.activeTrades = new Map();
    this.setupListeners();
  }

  setupListeners() {
    blockchain.on('swap-detected', async (swap) => {
      const users = await database.getAllUsers();
      
      users.forEach(async (user) => {
        if (this.shouldExecuteTrade(user, swap)) {
          this.executeMimicTrade(user, swap);
        }
      });
    });
  }

  shouldExecuteTrade(user, swap) {
    // Check if wallet is tracked by user
    const isTracked = user.alphaWallets.some(w => 
      database.getAlphaWallet(w)?.address === swap.wallet
    );
    
    // Check trade filters
    return isTracked && 
      user.settings.autoMimic &&
      (swap.isBuy ? !user.settings.sellOnly : !user.settings.buyOnly) &&
      this.activeTrades.get(`${user.id}-${swap.token}`) < user.settings.maxTradesPerToken;
  }

  async executeMimicTrade(user, swap) {
    try {
      // Apply delay if configured
      if (user.settings.delay > 0) {
        await sleep(user.settings.delay);
      }

      const quote = await jupiter.getQuote(
        swap.inputMint,
        swap.outputMint,
        user.settings.tradeAmount,
        user.settings.slippage
      );

      const txid = await jupiter.executeSwap(user.id, quote.route, {
        slippage: user.settings.slippage
      });

      // Update counters
      this.activeTrades.set(
        `${user.id}-${swap.token}`,
        (this.activeTrades.get(`${user.id}-${swap.token}`) || 0) + 1
      );

      await database.logTrade({
        userId: user.id,
        alphaWallet: swap.wallet,
        txid,
        token: swap.token,
        amount: user.settings.tradeAmount,
        direction: swap.isBuy ? 'buy' : 'sell'
      });

      // Notify user
      telegram.bot.api.sendMessage(
        user.id,
        `🔄 Mimicked trade:\n\n` +
        `Token: ${swap.token}\n` +
        `Action: ${swap.isBuy ? 'BUY' : 'SELL'}\n` +
        `Amount: ${user.settings.tradeAmount} SOL\n` +
        `TX: https://solscan.io/tx/${txid}`
      );
    } catch (error) {
      console.error(`Trade failed for user ${user.id}:`, error);
      // Send error notification
    }
  }
}

module.exports = new TradeExecutor();
