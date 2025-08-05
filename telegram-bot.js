const { Bot, InlineKeyboard } = require('grammy');
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
    // Main entry point
    this.bot.command('start', (ctx) => this.showMainDashboard(ctx));

    // Fallback for any text messages
    this.bot.on('message', (ctx) => this.handleMessage(ctx));

    // Handle all callback queries
    this.bot.on('callback_query:data', async (ctx) => {
      await this.handleCallback(ctx);
    });
  }

  // ===== MAIN INTERFACE SECTIONS ===== //

  async showMainDashboard(ctx) {
    const telegramId = ctx.from.id.toString();
    const user = await this.db.getUser(telegramId);

    const dashboard = new InlineKeyboard()
      .text('👛 Wallet', 'wallet_view').text('⚡ Trading', 'trading_view').row()
      .text('📊 Performance', 'performance_view').text('🔍 Discover', 'discover_view').row()
      .text('⚙️ Preferences', 'preferences_view');

    const status = user?.wallet_address ? 
      `🟢 Connected | ${user.wallet_address.slice(0, 4)}...${user.wallet_address.slice(-4)}` : 
      '🔴 Disconnected';

    await ctx.reply(
      `🌌 *Solana Copy Trading Dashboard*\n\n` +
      `*Status:* ${status}\n` +
      `*Last Trade:* ${user?.last_trade || 'Never'}\n` +
      `*Portfolio Value:* ${user?.portfolio_value || '0'} SOL\n\n` +
      `_Navigate using the menu below:_`,
      { 
        reply_markup: dashboard,
        parse_mode: 'Markdown'
      }
    );
  }

  async showWalletView(ctx) {
    const telegramId = ctx.from.id.toString();
    const user = await this.db.getUser(telegramId);

    const walletKeyboard = new InlineKeyboard();
    
    if (user?.wallet_address) {
      walletKeyboard
        .text('🔍 View Transactions', 'wallet_transactions')
        .text('🔄 Change Wallet', 'wallet_change').row();
    } else {
      walletKeyboard
        .text('🔗 Connect Wallet', 'wallet_connect').row();
    }

    walletKeyboard.text('◀️ Back', 'main_dashboard');

    const walletText = user?.wallet_address ?
      `👛 *Wallet Connected*\n\n` +
      `\`${user.wallet_address}\`\n\n` +
      `*Balance:* ${user.balance || '0'} SOL\n` +
      `*Tokens:* ${user.tokens?.length || '0'} assets` :
      `🔍 *Wallet Management*\n\n` +
      `No wallet connected. Connect to start copy trading.`;

    await this.editOrReply(ctx, walletText, walletKeyboard);
  }

  async showTradingView(ctx) {
    const telegramId = ctx.from.id.toString();
    const settings = await this.db.getUserSettings(telegramId);

    const tradingKeyboard = new InlineKeyboard()
      .text(settings.auto_trading ? '🟢 Auto Trading' : '🔴 Auto Trading', 'toggle_auto_trading')
      .text('📊 Strategies', 'trading_strategies').row()
      .text('⚡ Quick Settings', 'trading_quick_settings')
      .text('📜 Rules', 'trading_rules').row()
      .text('◀️ Back', 'main_dashboard');

    const tradingText = `⚡ *Trading Console*\n\n` +
      `*Status:* ${settings.auto_trading ? '🟢 Active' : '🔴 Paused'}\n` +
      `*Mode:* ${settings.strategy || 'Standard'}\n` +
      `*Risk Level:* ${settings.risk_level || 'Medium'}\n\n` +
      `_Last execution: ${settings.last_trade || 'Never'}_`;

    await this.editOrReply(ctx, tradingText, tradingKeyboard);
  }

  async showPreferencesView(ctx) {
    const telegramId = ctx.from.id.toString();
    const settings = await this.db.getUserSettings(telegramId);

    const prefKeyboard = new InlineKeyboard()
      .text(`💵 Amount: ${settings.max_trade_amount} SOL`, 'set_trade_amount')
      .text(`📉 Slippage: ${settings.slippage}%`, 'set_slippage').row()
      .text(`⏱ Speed: ${settings.speed || 'Normal'}`, 'set_speed')
      .text(`🔔 Notifications`, 'notification_settings').row()
      .text('◀️ Back', 'main_dashboard');

    const prefText = `⚙️ *Preferences*\n\n` +
      `Customize your trading experience below:\n\n` +
      `• *Max Trade:* ${settings.max_trade_amount} SOL\n` +
      `• *Slippage:* ${settings.slippage}%\n` +
      `• *Execution Speed:* ${settings.speed || 'Normal'}\n` +
      `• *Notifications:* ${settings.notifications ? '🔔 On' : '🔕 Off'}`;

    await this.editOrReply(ctx, prefText, prefKeyboard);
  }

  // ===== HELPER METHODS ===== //

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

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

    switch(data) {
      case 'main_dashboard':
        await this.showMainDashboard(ctx);
        break;
      case 'wallet_view':
        await this.showWalletView(ctx);
        break;
      case 'trading_view':
        await this.showTradingView(ctx);
        break;
      case 'preferences_view':
        await this.showPreferencesView(ctx);
        break;
      case 'toggle_auto_trading':
        await this.toggleAutoTrading(ctx);
        break;
      // Add more cases for other actions
      default:
        if (data.startsWith('set_')) {
          await this.handleSettingChange(ctx, data);
        }
    }
  }

  async toggleAutoTrading(ctx) {
    const telegramId = ctx.from.id.toString();
    const settings = await this.db.getUserSettings(telegramId);
    const newStatus = !settings.auto_trading;
    
    await this.db.updateUserSettings(telegramId, { auto_trading: newStatus });
    await this.showTradingView(ctx);
    
    // Send confirmation
    await ctx.reply(
      `Auto trading ${newStatus ? 'activated' : 'paused'} ${newStatus ? '🚀' : '⏸️'}\n` +
      `Your bot will ${newStatus ? 'now' : 'no longer'} automatically execute trades.`
    );
  }

  async handleSettingChange(ctx, action) {
    const setting = action.replace('set_', '');
    const telegramId = ctx.from.id.toString();
    this.userStates.set(telegramId, `setting_${setting}`);
    
    await ctx.reply(
      `Enter new value for ${setting.replace('_', ' ')}:\n\n` +
      `Current: ${await this.getCurrentSetting(telegramId, setting)}\n` +
      `(Type /cancel to abort)`
    );
  }

  async getCurrentSetting(telegramId, setting) {
    const settings = await this.db.getUserSettings(telegramId);
    return settings[setting] || 'Not set';
  }

  async handleMessage(ctx) {
    const telegramId = ctx.from.id.toString();
    const userState = this.userStates.get(telegramId);
    
    if (!userState || !userState.startsWith('setting_')) {
      // Show main dashboard if random message received
      await this.showMainDashboard(ctx);
      return;
    }

    const setting = userState.replace('setting_', '');
    const value = ctx.message.text.trim();
    
    if (value.toLowerCase() === '/cancel') {
      this.userStates.delete(telegramId);
      await ctx.reply('Changes canceled');
      return;
    }

    // Validate and save the setting
    if (await this.validateAndSaveSetting(ctx, setting, value)) {
      this.userStates.delete(telegramId);
      await this.showPreferencesView(ctx);
    }
  }

  async validateAndSaveSetting(ctx, setting, value) {
    // Add your validation logic here
    // Return true if successful, false otherwise
    return true;
  }
}

module.exports = CopyTradingBot;
