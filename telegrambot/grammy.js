const { Bot, Keyboard, InlineKeyboard, session } = require('grammy');
const config = require('../config/config.js');
const database = require('../database/database.js');
const walletManager = require('../wallet/walletManager.js');
const { encryptPrivateKey } = require('../security/auth.js');

class TelegramBot {
  constructor() {
    // Validate config before bot creation
    if (!config.getSync().telegram?.botToken) {
      throw new Error('Telegram bot token not configured');
    }

    this.bot = new Bot(config.getSync().telegram.botToken);
    this.setupMiddlewares();
    this.setupCommands();
    this.setupCallbacks();
    this.setupErrorHandling();
  }

  setupMiddlewares() {
    // Rate limiting
    this.bot.api.config.use(async (prev, method, payload) => {
      const canProceed = await database.checkRateLimit(payload.chat_id, 'telegram_command');
      if (!canProceed) {
        throw new Error('Rate limit exceeded');
      }
      return prev(method, payload);
    });

    // Session management
    this.bot.use(session({
      initial: () => ({
        step: 'idle',
        tempData: {}
      })
    }));
  }

  setupCommands() {
    // Start command
    this.bot.command('start', async (ctx) => {
      try {
        const userId = ctx.from.id;
        const user = await database.getUser(userId);

        if (!user) {
          await ctx.reply(
            '🚀 Welcome to Alpha Mimic Bot!\n\n' +
            'I track expert Solana wallets and copy their trades.\n\n' +
            'First, connect your wallet using /connect'
          );
          await database.createUser(userId, { username: ctx.from.username });
        } else {
          await ctx.reply(
            `Welcome back ${user.username || 'trader'}!\n\n` +
            `📊 Stats:\n` +
            `- Tracked wallets: ${user.alphaWallets?.length || 0}\n` +
            `- Total trades: ${user.totalTrades}\n\n` +
            `Use /help to see available commands`
          );
        }
      } catch (error) {
        console.error('Start command error:', error);
        await ctx.reply('❌ An error occurred. Please try again.');
      }
    });

    // Connect wallet
    this.bot.command('connect', async (ctx) => {
      try {
        ctx.session.step = 'awaiting_wallet';
        await ctx.reply(
          '🔐 Please send your wallet private key:\n\n' +
          '1. Open Phantom wallet\n' +
          '2. Go to Settings > Export Private Key\n' +
          '3. Paste it here\n\n' +
          '⚠️ Your key will be encrypted and never stored raw',
          { reply_markup: { remove_keyboard: true } }
        );
      } catch (error) {
        console.error('Connect command error:', error);
        await ctx.reply('❌ Failed to start wallet connection. Please try again.');
      }
    });

    // Add alpha wallet
    this.bot.command('addwallet', async (ctx) => {
      try {
        ctx.session.step = 'awaiting_alpha_wallet';
        await ctx.reply(
          '👑 Paste the alpha wallet address to track:\n\n' +
          'Example: D8W5...z7F2\n\n' +
          'Find proven wallets at:\n' +
          '- https://dexscreener.com/solana\n' +
          '- https://birdeye.so/leaderboard'
        );
      } catch (error) {
        console.error('Addwallet command error:', error);
        await ctx.reply('❌ Failed to start wallet tracking. Please try again.');
      }
    });

    // Settings command
    this.bot.command('settings', async (ctx) => {
      try {
        const user = await database.getUser(ctx.from.id);
        if (!user) return ctx.reply('Please /start first');

        const keyboard = new InlineKeyboard()
          .text(`Trade Amount (${user.settings.tradeAmount} SOL)`, 'set_trade_amount')
          .text(`Slippage (${user.settings.slippage}%)`, 'set_slippage').row()
          .text(`Delay (${user.settings.delay}ms)`, 'set_delay')
          .text(`Max Trades (${user.settings.maxTradesPerToken})`, 'set_max_trades').row()
          .text('Toggle Buys', 'toggle_buys')
          .text('Toggle Sells', 'toggle_sells');

        await ctx.reply('⚙️ Bot Settings:', { reply_markup: keyboard });
      } catch (error) {
        console.error('Settings command error:', error);
        await ctx.reply('❌ Failed to load settings. Please try again.');
      }
    });
  }

  setupCallbacks() {
    // Wallet connection handler
    this.bot.on('message:text', async (ctx) => {
      try {
        if (ctx.session.step === 'awaiting_wallet') {
          const { publicKey, keypair } = walletManager.importWallet(ctx.message.text);
          const encryptedKey = encryptPrivateKey(
            ctx.message.text, 
            config.getSync().security.encryptionKey
          );

          await database.updateUser(ctx.from.id, {
            wallet: {
              publicKey,
              encryptedKey
            }
          });

          ctx.session.step = 'idle';
          await ctx.reply(
            `✅ Wallet connected successfully!\n\n` +
            `Address: \`${publicKey}\`\n\n` +
            `Balance: ${await walletManager.getSOLBalance(publicKey)} SOL`,
            { parse_mode: 'Markdown' }
          );
        }
        else if (ctx.session.step === 'awaiting_alpha_wallet') {
          if (walletManager.isValidWalletAddress(ctx.message.text)) {
            await database.addAlphaWallet(ctx.from.id, ctx.message.text);
            ctx.session.step = 'idle';
            await ctx.reply(
              `✅ Now tracking wallet: \`${ctx.message.text}\``, 
              { parse_mode: 'Markdown' }
            );
          } else {
            await ctx.reply('❌ Invalid wallet address. Try /addwallet again');
          }
        }
      } catch (error) {
        console.error('Message handler error:', error);
        ctx.session.step = 'idle';
        await ctx.reply('❌ Operation failed. Please try again from the start.');
      }
    });

    // Settings callbacks
    this.bot.callbackQuery(/set_/, async (ctx) => {
      try {
        const action = ctx.callbackQuery.data;
        ctx.session.step = action;
        ctx.session.tempData = { setting: action.split('_')[1] };

        await ctx.editMessageText(
          `Enter new ${action.replace('set_', '').replace('_', ' ')} value:`,
          { reply_markup: new InlineKeyboard().text('Cancel', 'cancel_setting') }
        );
      } catch (error) {
        console.error('Callback query error:', error);
        await ctx.answerCallbackQuery('❌ Failed to process your request');
      }
    });

    // Cancel action
    this.bot.callbackQuery('cancel_setting', async (ctx) => {
      try {
        ctx.session.step = 'idle';
        await ctx.deleteMessage();
        await ctx.answerCallbackQuery('Settings update cancelled');
      } catch (error) {
        console.error('Cancel callback error:', error);
      }
    });
  }

  setupErrorHandling() {
    this.bot.catch(async (err) => {
      console.error('Global bot error:', err);
      // Notify admin via Telegram if needed
      const adminIds = config.getSync().telegram.adminChatIds?.split(',') || [];
      for (const chatId of adminIds) {
        try {
          await this.bot.api.sendMessage(
            chatId, 
            `⚠️ Bot error:\n${err.message || 'Unknown error'}`
          );
        } catch (adminError) {
          console.error('Failed to notify admin:', adminError);
        }
      }
    });

    // Global error response
    this.bot.on('::error', async (err) => {
      console.error('Unhandled error:', err);
      try {
        await err.ctx.reply('❌ An unexpected error occurred. Please try again later.');
      } catch (replyError) {
        console.error('Failed to send error message:', replyError);
      }
    });
  }

  async start() {
    try {
      await this.bot.start();
      console.log('🤖 Telegram bot started successfully');
    } catch (error) {
      console.error('Failed to start bot:', error);
      process.exit(1);
    }
  }
}

// Export promise that resolves to initialized bot
module.exports = (async () => {
  try {
    await config.validate();
    return new TelegramBot();
  } catch (error) {
    console.error('Failed to initialize Telegram bot:', error);
    process.exit(1);
  }
})();
