import database from '../database/database.js';
import jupiter from './jupiterService.js';
import blockchain from '../blockchain/blockchainMonitor.js';
import { sleep } from '../utils/helpers.js';
import telegram from '../telegrambot/grammy.js'; // Assuming you have a default export for telegram

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
    const isTracked = user.alphaWallets.some(w =>
      database.getAlphaWallet(w)?.address === swap.wallet
    );

    return (
      isTracked &&
      user.settings.autoMimic &&
      (swap.isBuy ? !user.settings.sellOnly : !user.settings.buyOnly) &&
      (this.activeTrades.get(`${user.id}-${swap.token}`) || 0) < user.settings.maxTradesPerToken
    );
  }

  async executeMimicTrade(user, swap) {
    try {
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

      await telegram.bot.api.sendMessage(
        user.id,
        `🔄 Mimicked trade:\n\n` +
        `Token: ${swap.token}\n` +
        `Action: ${swap.isBuy ? 'BUY' : 'SELL'}\n` +
        `Amount: ${user.settings.tradeAmount} SOL\n` +
        `TX: https://solscan.io/tx/${txid}`
      );
    } catch (error) {
      console.error(`Trade failed for user ${user.id}:`, error);
      // Optional: add error notification logic
    }
  }
}

const tradeExecutor = new TradeExecutor();
export default tradeExecutor;