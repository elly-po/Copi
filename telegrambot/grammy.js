const { Bot, Keyboard, InlineKeyboard, session } = require('grammy');
const config = require('../config/config');
const database = require('../database/database');
const walletManager = require('../wallet/walletManager');
const { encryptPrivateKey } = require('../security/auth');

class TelegramBot {
  constructor() {
    this.bot = new Bot(config.telegram.botToken);
    this.setupMiddlewares();
    this.setupCommands();
    this.setupCallbacks();
    this.setupErrorHandling();
  }

  setupMiddlewares() {
    // Rate limiting
    this.bot.api.config.use((prev, method, payload) => {
      return database.checkRateLimit(payload.chat_id, 'telegram_command')
        .then(canProceed => {
          if (!canProceed) throw new Error('Rate limit exceeded');
          return prev(method, payload);
        });
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
    });

    // Connect wallet
    this.bot.command('connect', async (ctx) => {
      ctx.session.step = 'awaiting_wallet';
      await ctx.reply(
        '🔐 Please send your wallet private key:\n\n' +
        '1. Open Phantom wallet\n' +
        '2. Go to Settings > Export Private Key\n' +
        '3. Paste it here\n\n' +
        '⚠️ Your key will be encrypted and never stored raw',
        { reply_markup: { remove_keyboard: true } }
      );
    });

    // Add alpha wallet
    this.bot.command('addwallet', async (ctx) => {
      ctx.session.step = 'awaiting_alpha_wallet';
      await ctx.reply(
        '👑 Paste the alpha wallet address to track:\n\n' +
        'Example: D8W5...z7F2\n\n' +
        'Find proven wallets at:\n' +
        '- https://dexscreener.com/solana\n' +
        '- https://birdeye.so/leaderboard'
      );
    });

    // Settings
    this.bot.command('settings', async (ctx) => {
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
    });
  }

  setupCallbacks() {
    // Wallet connection handler
    this.bot.on('message:text', async (ctx) => {
      if (ctx.session.step === 'awaiting_wallet') {
        try {
          const { publicKey, keypair } = walletManager.importWallet(ctx.message.text);
          const encryptedKey = encryptPrivateKey(ctx.message.text, config.security.encryptionKey);
          
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
        } catch (e) {
          await ctx.reply('❌ Invalid private key. Please try /connect again');
        }
      }
      
      // Alpha wallet handler
      else if (ctx.session.step === 'awaiting_alpha_wallet') {
        if (walletManager.isValidWalletAddress(ctx.message.text)) {
          await database.addAlphaWallet(ctx.from.id, ctx.message.text);
          ctx.session.step = 'idle';
          await ctx.reply(`✅ Now tracking wallet: \`${ctx.message.text}\``, { parse_mode: 'Markdown' });
        } else {
          await ctx.reply('❌ Invalid wallet address. Try /addwallet again');
        }
      }
    });

    // Settings callbacks
    this.bot.callbackQuery(/set_/, async (ctx) => {
      const action = ctx.callbackQuery.data;
      ctx.session.step = action;
      ctx.session.tempData = { setting: action.split('_')[1] };
      
      await ctx.editMessageText(
        `Enter new ${action.replace('set_', '').replace('_', ' ')} value:`,
        { reply_markup: new InlineKeyboard().text('Cancel', 'cancel_setting') }
      );
    });
  }

  setupErrorHandling() {
    this.bot.catch((err) => {
      console.error('Bot error:', err);
      // Notify admin or log to monitoring service
    });
  }

  start() {
    this.bot.start();
    console.log('🤖 Telegram bot started');
  }
}

module.exports = new TelegramBot();
