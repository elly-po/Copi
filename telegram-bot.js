const { Bot, InlineKeyboard } = require('grammy');
const Database = require('./database');
require('dotenv').config();

class CopyTradingBot {
  constructor() {
    this.bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
    this.userStates = new Map();
    this.setupHandlers();
  }

  setupHandlers() {
    // Main command handler
    this.bot.command('start', (ctx) => this.showMainDashboard(ctx));

    // Unified callback handler
    this.bot.on('callback_query:data', async (ctx) => {
      try {
        const action = ctx.callbackQuery.data;
        console.log(`Action triggered: ${action}`);
        
        if (action.startsWith('wallet:')) await this.handleWalletAction(ctx, action);
        else if (action.startsWith('trade:')) await this.handleTradeAction(ctx, action);
        else if (action.startsWith('settings:')) await this.handleSettingsAction(ctx, action);
        else if (action === 'refresh') await this.showMainDashboard(ctx);
        
        await ctx.answerCallbackQuery();
      } catch (error) {
        console.error('Callback error:', error);
        await ctx.answerCallbackQuery({ text: '⚠️ Action failed', show_alert: true });
      }
    });

    // Message handler for wallet addresses and settings
    this.bot.on('message', (ctx) => this.handleMessage(ctx));

    // Error handler
    this.bot.catch((err) => {
      console.error('Bot error:', err);
    });

    console.log('🚀 Bot is ready');
  }

  // ======================
  // CORE VIEWS
  // ======================
  async showMainDashboard(ctx) {
    const telegramId = ctx.from.id.toString();
    const [user, settings] = await Promise.all([
      Database.getUser(telegramId),
      Database.getUserSettings(telegramId)
    ]);

    const dashboard = new InlineKeyboard()
      .text('💼 Wallet', 'wallet:view')
      .text('⚡ Trading', 'trade:dashboard').row()
      .text('📊 Stats', 'trade:stats')
      .text('⚙️ Settings', 'settings:view').row()
      .text('🔄 Refresh', 'refresh');

    const status = user?.wallet_address 
      ? `🟢 Connected (${user.wallet_address.slice(0, 4)}...${user.wallet_address.slice(-4)})`
      : '🔴 Disconnected';

    await ctx.reply(
      `✨ *Solana Copy Trading*\n\n` +
      `*Status:* ${status}\n` +
      `*Auto Trading:* ${settings.auto_trading ? '🟢 ON' : '🔴 OFF'}\n` +
      `*Max Trade:* ${settings.max_trade_amount} SOL\n\n` +
      `_Select an option below:_`,
      { reply_markup: dashboard, parse_mode: 'Markdown' }
    );
  }

  // ======================
  // WALLET HANDLERS
  // ======================
  async handleWalletAction(ctx, action) {
    const [_, command] = action.split(':');
    const telegramId = ctx.from.id.toString();
    
    switch(command) {
      case 'view':
        await this.showWalletView(ctx, telegramId);
        break;
      case 'connect':
        await this.initiateWalletConnect(ctx, telegramId);
        break;
      case 'disconnect':
        await this.disconnectWallet(ctx, telegramId);
        break;
      case 'confirm':
        await this.confirmWalletConnection(ctx, telegramId);
        break;
    }
  }

  async showWalletView(ctx, telegramId) {
    const user = await Database.getUser(telegramId);
    const keyboard = new InlineKeyboard();

    if (user?.wallet_address) {
      keyboard
        .text('🚫 Disconnect', 'wallet:disconnect')
        .text('🔄 Change', 'wallet:connect').row();
    } else {
      keyboard.text('🔗 Connect Wallet', 'wallet:connect').row();
    }
    keyboard.text('◀️ Back', 'refresh');

    const message = user?.wallet_address
      ? `💼 *Wallet*\n\n` +
        `\`${user.wallet_address}\`\n\n` +
        `_Manage your connected wallet_`
      : `🔗 *Wallet Connection*\n\n` +
        `No wallet connected. Connect to start trading.`;

    await this.editOrReply(ctx, message, keyboard);
  }

  async initiateWalletConnect(ctx, telegramId) {
    this.userStates.set(telegramId, 'awaiting_wallet');
    await this.editOrReply(
      ctx,
      `🔗 *Connect Wallet*\n\n` +
      `Please send your Solana wallet address:\n\n` +
      `⚠️ Only public address required\n` +
      `Never share private keys!`,
      new InlineKeyboard().text('❌ Cancel', 'wallet:view')
    );
  }

  async disconnectWallet(ctx, telegramId) {
    await Database.updateUserSettings(telegramId, { wallet_address: null });
    await this.editOrReply(
      ctx,
      '✅ Wallet disconnected successfully',
      new InlineKeyboard().text('◀️ Back', 'wallet:view')
    );
  }

  // ======================
  // TRADING HANDLERS
  // ======================
  async handleTradeAction(ctx, action) {
    const [_, command] = action.split(':');
    const telegramId = ctx.from.id.toString();
    
    switch(command) {
      case 'dashboard':
        await this.showTradeDashboard(ctx, telegramId);
        break;
      case 'stats':
        await this.showTradeStats(ctx, telegramId);
        break;
      case 'toggle':
        await this.toggleAutoTrading(ctx, telegramId);
        break;
      case 'history':
        await this.showTradeHistory(ctx, telegramId);
        break;
    }
  }

  async showTradeDashboard(ctx, telegramId) {
    const settings = await Database.getUserSettings(telegramId);
    const keyboard = new InlineKeyboard()
      .text(settings.auto_trading ? '🟢 Stop Trading' : '🔴 Start Trading', 'trade:toggle').row()
      .text('📈 Stats', 'trade:stats')
      .text('📜 History', 'trade:history').row()
      .text('◀️ Back', 'refresh');

    await this.editOrReply(
      ctx,
      `⚡ *Trading Console*\n\n` +
      `*Status:* ${settings.auto_trading ? '🟢 ACTIVE' : '🔴 PAUSED'}\n` +
      `*Max Trade:* ${settings.max_trade_amount} SOL\n` +
      `*Slippage:* ${settings.slippage}%\n\n` +
      `_Last executed: ${new Date().toLocaleString()}_`,
      keyboard
    );
  }

  async toggleAutoTrading(ctx, telegramId) {
    const settings = await Database.getUserSettings(telegramId);
    const newStatus = !settings.auto_trading;
    
    await Database.updateUserSettings(telegramId, { auto_trading: newStatus });
    await this.showTradeDashboard(ctx, telegramId);
    
    // Send confirmation
    await ctx.api.sendMessage(
      telegramId,
      `Auto trading ${newStatus ? 'activated 🚀' : 'paused ⏸️'}\n` +
      `Your bot will ${newStatus ? 'now' : 'no longer'} execute trades automatically.`
    );
  }

  // ======================
  // SETTINGS HANDLERS
  // ======================
  async handleSettingsAction(ctx, action) {
    const [_, command] = action.split(':');
    const telegramId = ctx.from.id.toString();
    
    switch(command) {
      case 'view':
        await this.showSettingsView(ctx, telegramId);
        break;
      case 'amount':
        await this.changeTradeAmount(ctx, telegramId);
        break;
      case 'slippage':
        await this.changeSlippage(ctx, telegramId);
        break;
    }
  }

  async showSettingsView(ctx, telegramId) {
    const settings = await Database.getUserSettings(telegramId);
    const keyboard = new InlineKeyboard()
      .text(`💰 ${settings.max_trade_amount} SOL`, 'settings:amount')
      .text(`📉 ${settings.slippage}%`, 'settings:slippage').row()
      .text('◀️ Back', 'refresh');

    await this.editOrReply(
      ctx,
      `⚙️ *Settings*\n\n` +
      `*Max Trade:* ${settings.max_trade_amount} SOL\n` +
      `*Slippage:* ${settings.slippage}%\n` +
      `*Min Liquidity:* ${settings.min_liquidity} SOL\n\n` +
      `_Tap to modify any value_`,
      keyboard
    );
  }

  // ======================
  // MESSAGE HANDLER
  // ======================
  async handleMessage(ctx) {
    const telegramId = ctx.from.id.toString();
    const userState = this.userStates.get(telegramId);
    const text = ctx.message.text.trim();

    if (!userState) {
      await this.showMainDashboard(ctx);
      return;
    }

    try {
      if (userState === 'awaiting_wallet') {
        if (this.isValidSolanaAddress(text)) {
          await Database.createUser(telegramId, text);
          this.userStates.delete(telegramId);
          await ctx.reply(`✅ Wallet connected successfully!`);
          await this.showWalletView(ctx, telegramId);
        } else {
          await ctx.reply('❌ Invalid Solana address. Please try again.');
        }
      }
    } catch (error) {
      console.error('Message handling error:', error);
      await ctx.reply('⚠️ Failed to process your input. Please try again.');
    }
  }

  // ======================
  // UTILITIES
  // ======================
  async editOrReply(ctx, text, keyboard) {
    try {
      await ctx.editMessageText(text, { 
        reply_markup: keyboard,
        parse_mode: 'Markdown'
      });
    } catch {
      await ctx.reply(text, { 
        reply_markup: keyboard,
        parse_mode: 'Markdown'
      });
    }
  }

  isValidSolanaAddress(address) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }
}

// Start the bot
const bot = new CopyTradingBot();
process.once('SIGINT', () => bot.bot.stop());
process.once('SIGTERM', () => bot.bot.stop());

module.exports = bot;