const { Bot, Keyboard, InlineKeyboard } = require('grammy');
const Database = require('./database');
require('dotenv').config();

class CopyTradingBot {
  constructor() {
    this.bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
    this.db = Database;
    this.userStates = new Map();
    this.setupHandlers();
  }

  setupHandlers() {
    // Command handlers
    this.bot.command('start', (ctx) => this.handleStart(ctx));
    this.bot.command('help', (ctx) => this.handleHelp(ctx));
    this.bot.command('status', (ctx) => this.handleStatus(ctx));
    this.bot.command('trades', (ctx) => this.handleTrades(ctx));

    // Callback query handler
    this.bot.on('callback_query:data', async (ctx) => {
      await this.handleCallback(ctx);
    });

    // Message handler for wallet addresses
    this.bot.on('message', (ctx) => this.handleMessage(ctx));

    console.log('Telegram bot started and listening...');
  }

  async handleStart(ctx) {
    const chatId = ctx.chat.id;
    const telegramId = ctx.from.id.toString();

    try {
      // Check if user exists
      let user = await this.db.getUser(telegramId);
      
      if (!user) {
        await this.db.createUser(telegramId);
        user = await this.db.getUser(telegramId);
      }

      const welcomeText = `🚀 Welcome to Solana Copy Trading Bot!

This bot helps you copy trades from high-performance wallets in the Solana memecoin space.

Click the buttons below to get started:`;

      const keyboard = new InlineKeyboard()
        .text('💰 Connect Wallet', 'connect_wallet')
        .text('⚙️ Settings', 'settings').row()
        .text('📊 View Tracked Wallets', 'view_wallets')
        .text('📈 Trading Status', 'trading_status').row()
        .text('📚 Help', 'help')
        .text('📋 Recent Trades', 'recent_trades');

      await ctx.reply(welcomeText, { reply_markup: keyboard });
    } catch (error) {
      console.error('Error in handleStart:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  async handleCallback(ctx) {
    const chatId = ctx.chat.id;
    const telegramId = ctx.from.id.toString();
    const data = ctx.callbackQuery.data;

    try {
      await ctx.answerCallbackQuery();

      switch (data) {
        case 'connect_wallet':
          await this.showConnectWallet(ctx);
          break;
        case 'settings':
          await this.showSettings(ctx);
          break;
        case 'view_wallets':
          await this.showTrackedWallets(ctx);
          break;
        case 'trading_status':
          await this.showTradingStatus(ctx);
          break;
        case 'help':
          await this.showHelp(ctx);
          break;
        case 'recent_trades':
          await this.showRecentTrades(ctx);
          break;
        case 'back_main':
          await this.handleStart(ctx);
          break;
        default:
          if (data.startsWith('setting_')) {
            await this.handleSettingCallback(ctx, data);
          } else if (data.startsWith('set_')) {
            await this.handleSetValue(ctx, data);
          }
          break;
      }
    } catch (error) {
      console.error('Error in handleCallback:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  async showConnectWallet(ctx) {
    const telegramId = ctx.from.id.toString();
    const user = await this.db.getUser(telegramId);
    
    if (user && user.wallet_address) {
      const text = `✅ Wallet Connected!

Your wallet: \`${user.wallet_address}\`

⚠️ **Security Note:** This bot uses wallet monitoring only. Your private keys are never shared or stored.`;

      const keyboard = new InlineKeyboard()
        .text('🔄 Change Wallet', 'change_wallet').row()
        .text('🔙 Back to Main', 'back_main');

      await ctx.reply(text, { 
        reply_markup: keyboard, 
        parse_mode: 'Markdown' 
      });
    } else {
      const text = `🔗 Connect Your Solana Wallet

To start copy trading, please send your Solana wallet address.

⚠️ **Important:** 
- Only send your PUBLIC wallet address
- Never share your private key or seed phrase
- The bot only monitors transactions, it cannot access your funds

Please paste your wallet address below:`;

      this.userStates.set(telegramId, 'waiting_wallet_address');
      
      const keyboard = new InlineKeyboard()
        .text('🔙 Back to Main', 'back_main');

      await ctx.reply(text, { reply_markup: keyboard });
    }
  }

  async showSettings(ctx) {
    const telegramId = ctx.from.id.toString();
    const settings = await this.db.getUserSettings(telegramId);
    
    const text = `⚙️ **Trading Settings**

💰 Max Trade Amount: ${settings.max_trade_amount} SOL
📊 Slippage: ${settings.slippage}%
💧 Min Liquidity: ${settings.min_liquidity} SOL
⏱️ Tracking Period: ${settings.tracking_period}s
🔄 Max Trades/Hour: ${settings.max_trades_per_hour}
🤖 Auto Trading: ${settings.auto_trading ? '✅ ON' : '❌ OFF'}`;

    const keyboard = new InlineKeyboard()
      .text(`💰 Trade Amount (${settings.max_trade_amount})`, 'setting_max_amount')
      .text(`📊 Slippage (${settings.slippage}%)`, 'setting_slippage').row()
      .text(`💧 Min Liquidity (${settings.min_liquidity})`, 'setting_liquidity')
      .text(`⏱️ Period (${settings.tracking_period}s)`, 'setting_period').row()
      .text(`🔄 Max/Hour (${settings.max_trades_per_hour})`, 'setting_max_trades')
      .text(`🤖 Auto: ${settings.auto_trading ? 'ON' : 'OFF'}`, 'setting_auto_toggle').row()
      .text('💾 Save & Start Trading', 'start_trading')
      .text('🔙 Back', 'back_main');

    try {
      await ctx.editMessageText(text, {
        reply_markup: keyboard,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
  }

  async handleSettingCallback(ctx, data) {
    const telegramId = ctx.from.id.toString();
    const setting = data.replace('setting_', '');
    
    const settingInfo = {
      max_amount: { name: 'Max Trade Amount', unit: 'SOL', min: 0.01, max: 10 },
      slippage: { name: 'Slippage', unit: '%', min: 1, max: 20 },
      liquidity: { name: 'Min Liquidity', unit: 'SOL', min: 100, max: 50000 },
      period: { name: 'Tracking Period', unit: 'seconds', min: 60, max: 3600 },
      max_trades: { name: 'Max Trades per Hour', unit: 'trades', min: 1, max: 50 },
      auto_toggle: { name: 'Auto Trading', unit: '', min: 0, max: 1 }
    };

    if (setting === 'auto_toggle') {
      const settings = await this.db.getUserSettings(telegramId);
      await this.db.updateUserSettings(telegramId, { 
        auto_trading: !settings.auto_trading 
      });
      await this.showSettings(ctx);
      return;
    }

    const info = settingInfo[setting];
    if (!info) return;

    const text = `🔧 **Set ${info.name}**

Current value: **${await this.getCurrentSettingValue(telegramId, setting)} ${info.unit}**

Range: ${info.min} - ${info.max} ${info.unit}

Please enter the new value:`;

    this.userStates.set(telegramId, `setting_${setting}`);

    const keyboard = new InlineKeyboard()
      .text('🔙 Back to Settings', 'settings');

    await ctx.reply(text, { 
      reply_markup: keyboard, 
      parse_mode: 'Markdown' 
    });
  }

  async getCurrentSettingValue(telegramId, setting) {
    const settings = await this.db.getUserSettings(telegramId);
    const mapping = {
      max_amount: settings.max_trade_amount,
      slippage: settings.slippage,
      liquidity: settings.min_liquidity,
      period: settings.tracking_period,
      max_trades: settings.max_trades_per_hour
    };
    return mapping[setting] || 0;
  }

  async showTrackedWallets(ctx) {
    const wallets = await this.db.getTrackedWallets();
    
    if (wallets.length === 0) {
      const text = `📊 **Tracked Alpha Wallets**

No wallets are currently being tracked.

Contact the admin to add high-performance wallets to the tracking list.`;

      const keyboard = new InlineKeyboard()
        .text('🔙 Back to Main', 'back_main');

      await ctx.reply(text, { 
        reply_markup: keyboard, 
        parse_mode: 'Markdown' 
      });
      return;
    }

    let text = `📊 **Tracked Alpha Wallets** (${wallets.length})\n\n`;
    
    wallets.forEach((wallet, index) => {
      text += `${index + 1}. **${wallet.name}**\n`;
      text += `   📍 \`${wallet.wallet_address.slice(0, 8)}...${wallet.wallet_address.slice(-8)}\`\n`;
      text += `   📈 Success Rate: ${wallet.success_rate.toFixed(1)}%\n`;
      text += `   🔄 Total Trades: ${wallet.total_trades}\n\n`;
    });

    const keyboard = new InlineKeyboard()
      .text('🔄 Refresh', 'view_wallets').row()
      .text('🔙 Back to Main', 'back_main');

    await ctx.reply(text, { 
      reply_markup: keyboard, 
      parse_mode: 'Markdown' 
    });
  }

  async showTradingStatus(ctx) {
    const telegramId = ctx.from.id.toString();
    const user = await this.db.getUser(telegramId);
    const settings = await this.db.getUserSettings(telegramId);
    
    if (!user || !user.wallet_address) {
      await ctx.reply('❌ Please connect your wallet first.', {
        reply_markup: new InlineKeyboard()
          .text('🔗 Connect Wallet', 'connect_wallet').row()
          .text('🔙 Back', 'back_main')
      });
      return;
    }

    const statusIcon = settings.auto_trading ? '🟢' : '🔴';
    const statusText = settings.auto_trading ? 'ACTIVE' : 'INACTIVE';

    const text = `📈 **Trading Status**

${statusIcon} Status: **${statusText}**

👛 Connected Wallet: \`${user.wallet_address.slice(0, 8)}...${user.wallet_address.slice(-8)}\`
💰 Max Trade Amount: ${settings.max_trade_amount} SOL
🔄 Max Trades/Hour: ${settings.max_trades_per_hour}
📊 Slippage: ${settings.slippage}%

${settings.auto_trading ? '✅ Bot is actively monitoring and copying trades!' : '⚠️ Auto trading is disabled. Enable it in settings.'}`;

    const keyboard = new InlineKeyboard()
      .text(
        settings.auto_trading ? '⏹️ Stop Trading' : '▶️ Start Trading', 
        'setting_auto_toggle'
      )
      .text('⚙️ Settings', 'settings').row()
      .text('🔙 Back to Main', 'back_main');

    await ctx.reply(text, { 
      reply_markup: keyboard, 
      parse_mode: 'Markdown' 
    });
  }

  async showRecentTrades(ctx) {
    const telegramId = ctx.from.id.toString();
    const trades = await this.db.getUserTrades(telegramId, 10);
    
    if (trades.length === 0) {
      const text = `📋 **Recent Trades**

No trades found. Start auto trading to see your copy trades here!`;

      const keyboard = new InlineKeyboard()
        .text('▶️ Start Trading', 'trading_status').row()
        .text('🔙 Back to Main', 'back_main');

      await ctx.reply(text, { reply_markup: keyboard });
      return;
    }

    let text = `📋 **Recent Trades** (${trades.length})\n\n`;
    
    trades.forEach((trade, index) => {
      const date = new Date(trade.created_at).toLocaleString();
      const pnlIcon = trade.profit_loss >= 0 ? '📈' : '📉';
      const statusIcon = trade.status === 'completed' ? '✅' : '⏳';
      
      text += `${index + 1}. ${statusIcon} ${trade.trade_type}\n`;
      text += `   💰 Amount: ${trade.amount} SOL\n`;
      text += `   ${pnlIcon} P&L: ${trade.profit_loss.toFixed(4)} SOL\n`;
      text += `   📅 ${date}\n\n`;
    });

    const keyboard = new InlineKeyboard()
      .text('🔄 Refresh', 'recent_trades').row()
      .text('🔙 Back to Main', 'back_main');

    await ctx.reply(text, { 
      reply_markup: keyboard, 
      parse_mode: 'Markdown' 
    });
  }

  async showHelp(ctx) {
    const text = `📚 **Help & Instructions**

**🚀 Getting Started:**
1. Connect your Solana wallet (public address only)
2. Configure your trading settings
3. Enable auto trading
4. The bot will copy trades from tracked alpha wallets

**⚙️ Settings Explained:**
• **Max Trade Amount**: Maximum SOL per trade
• **Slippage**: Price tolerance for trades (1-20%)
• **Min Liquidity**: Minimum token liquidity to trade
• **Tracking Period**: How often to check for new trades
• **Max Trades/Hour**: Rate limit for safety

**🔒 Security:**
• Only your public wallet address is used
• Private keys are never requested or stored
• All trades are executed through Jupiter DEX
• You maintain full control of your funds

**⚠️ Risks:**
• Copy trading involves high risk
• Only invest what you can afford to lose
• Memecoins are highly volatile
• Past performance doesn't guarantee future results

**📞 Support:**
If you need assistance, contact the admin.`;

    const keyboard = new InlineKeyboard()
      .text('🔙 Back to Main', 'back_main');

    await ctx.reply(text, { 
      reply_markup: keyboard, 
      parse_mode: 'Markdown' 
    });
  }

  async handleMessage(ctx) {
    if (!ctx.message.text || ctx.message.text.startsWith('/')) return;

    const chatId = ctx.chat.id;
    const telegramId = ctx.from.id.toString();
    const text = ctx.message.text.trim();
    const userState = this.userStates.get(telegramId);

    try {
      if (userState === 'waiting_wallet_address') {
        await this.handleWalletAddress(ctx, text);
      } else if (userState && userState.startsWith('setting_')) {
        await this.handleSettingValue(ctx, userState, text);
      }
    } catch (error) {
      console.error('Error in handleMessage:', error);
      await ctx.reply('❌ An error occurred processing your message.');
    }
  }

  async handleWalletAddress(ctx, address) {
    const chatId = ctx.chat.id;
    const telegramId = ctx.from.id.toString();

    // Validate Solana address format
    if (!this.isValidSolanaAddress(address)) {
      await ctx.reply('❌ Invalid Solana address format. Please try again.');
      return;
    }

    try {
      await this.db.createUser(telegramId, address);
      this.userStates.delete(telegramId);

      const text = `✅ **Wallet Connected Successfully!**

Your wallet: \`${address.slice(0, 8)}...${address.slice(-8)}\`

You can now configure your trading settings and start copy trading!`;

      const keyboard = new InlineKeyboard()
        .text('⚙️ Configure Settings', 'settings').row()
        .text('🔙 Back to Main', 'back_main');

      await ctx.reply(text, { 
        reply_markup: keyboard, 
        parse_mode: 'Markdown' 
      });
    } catch (error) {
      console.error('Error saving wallet:', error);
      await ctx.reply('❌ Error saving wallet address. Please try again.');
    }
  }

  async handleSettingValue(ctx, userState, value) {
    const telegramId = ctx.from.id.toString();
    const chatId = ctx.chat.id;
    const setting = userState.replace('setting_', '');
    const numValue = parseFloat(value);

    if (isNaN(numValue)) {
      await ctx.reply('❌ Please enter a valid number.');
      return;
    }

    // Validate ranges
    const ranges = {
      max_amount: { min: 0.01, max: 10 },
      slippage: { min: 1, max: 20 },
      liquidity: { min: 100, max: 50000 },
      period: { min: 60, max: 3600 },
      max_trades: { min: 1, max: 50 }
    };

    const range = ranges[setting];
    if (range && (numValue < range.min || numValue > range.max)) {
      await ctx.reply(`❌ Value must be between ${range.min} and ${range.max}.`);
      return;
    }

    try {
      const updateObj = {};
      const fieldMapping = {
        max_amount: 'max_trade_amount',
        slippage: 'slippage',
        liquidity: 'min_liquidity',
        period: 'tracking_period',
        max_trades: 'max_trades_per_hour'
      };

      updateObj[fieldMapping[setting]] = numValue;
      await this.db.updateUserSettings(telegramId, updateObj);
      
      this.userStates.delete(telegramId);

      await ctx.reply(`✅ Setting updated successfully!`);
      
      // Show settings again
      setTimeout(() => {
        this.showSettings(ctx);
      }, 1000);

    } catch (error) {
      console.error('Error updating setting:', error);
      await ctx.reply('❌ Error updating setting. Please try again.');
    }
  }

  isValidSolanaAddress(address) {
    // Basic Solana address validation
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && address.length >= 32 && address.length <= 44;
  }

  async handleHelp(ctx) {
    await this.showHelp(ctx);
  }

  async handleStatus(ctx) {
    await this.showTradingStatus(ctx);
  }

  async handleTrades(ctx) {
    await this.showRecentTrades(ctx);
  }

  // Method to send trade notifications
  async sendTradeNotification(telegramId, tradeData) {
    try {
      const { tradeRecord, tokenSymbol, tokenName } = tradeData;
      
      const text = `🎯 **Trade Executed!**

💰 Token: ${tokenSymbol} (${tokenName})
📊 Type: ${tradeRecord.tradeType}
💵 Amount: ${tradeRecord.amount} SOL
💲 Price: ${tradeRecord.price.toFixed(8)}
🔗 Signature: \`${tradeRecord.signature.slice(0, 16)}...\`

✅ Trade completed successfully!`;

      const keyboard = new InlineKeyboard()
        .text('📈 View All Trades', 'recent_trades').row()
        .text('⚙️ Settings', 'settings');

      await this.bot.api.sendMessage(telegramId, text, { 
        reply_markup: keyboard, 
        parse_mode: 'Markdown' 
      });
    } catch (error) {
      console.error('Error sending trade notification:', error);
    }
  }

  async sendTradeError(telegramId, errorData) {
    try {
      const { error, tokenSymbol } = errorData;
      
      const text = `❌ **Trade Failed**

💰 Token: ${tokenSymbol}
🚫 Error: ${error}

The trade could not be executed. Please check your settings and try again.`;

      await this.bot.api.sendMessage(telegramId, text);
    } catch (error) {
      console.error('Error sending trade error notification:', error);
    }
  }
}

module.exports = CopyTradingBot;
