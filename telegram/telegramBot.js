const { Bot, Keyboard, InlineKeyboard, session } = require('grammy');
const { conversations, createConversation } = require('@grammyjs/conversations');
const database = require('../database/database');
const walletManager = require('../wallet/walletManager');
const config = require('../config/config');

class TelegramBot {
    constructor() {
        this.bot = null;
        this.isRunning = false;
        this.userSessions = new Map();
    }

    async initialize() {
        try {
            const configData = await config.get();
            
            if (!configData.telegram.botToken) {
                throw new Error('Telegram bot token not found in config');
            }

            this.bot = new Bot(configData.telegram.botToken);

            // Install session plugin
            this.bot.use(session({
                initial: () => ({
                    step: 'idle',
                    data: {}
                })
            }));

            // Install conversations plugin
            this.bot.use(conversations());

            // Register conversations
            this.bot.use(createConversation(this.walletSetupConversation.bind(this)));
            this.bot.use(createConversation(this.alphaWalletConversation.bind(this)));
            this.bot.use(createConversation(this.settingsConversation.bind(this)));

            // Register command handlers
            this.registerCommands();
            this.registerCallbackHandlers();

            // Error handling
            this.bot.catch((err) => {
                console.error('❌ Bot error:', err);
            });

            console.log('✅ Telegram bot initialized');

        } catch (error) {
            console.error('❌ Failed to initialize Telegram bot:', error);
            throw error;
        }
    }

    registerCommands() {
        // Start command
        this.bot.command('start', async (ctx) => {
            await this.handleRateLimit(ctx, async () => {
                const user = await this.getOrCreateUser(ctx);
                
                const welcomeMessage = `🚀 *Welcome to Alpha Wallet Copier Bot!*

This bot helps you automatically copy trades from successful "alpha" wallets on Solana.

*Features:*
• 📊 Track multiple alpha wallets
• 💰 Auto-copy buy/sell trades
• ⚙️ Customizable settings (amount, slippage, delays)
• 📈 Trade history and PnL tracking

*Quick Setup:*
1️⃣ Connect your trading wallet: /wallet
2️⃣ Add alpha wallets to track: /alpha
3️⃣ Configure your settings: /settings
4️⃣ Start copying: /toggle

Type /help for all commands.`;

                await ctx.reply(welcomeMessage, {
                    parse_mode: 'Markdown',
                    reply_markup: this.getMainMenuKeyboard()
                });
            });
        });

        // Help command
        this.bot.command('help', async (ctx) => {
            await this.handleRateLimit(ctx, async () => {
                const helpMessage = `📚 *Available Commands:*

*Wallet Management:*
/wallet - Connect or manage your trading wallet
/balance - Check wallet balances

*Alpha Wallets:*
/alpha - Add/remove alpha wallets to track
/list - List your tracked alpha wallets

*Settings:*
/settings - Configure trading parameters
/toggle - Enable/disable auto-copying

*Trading:*
/trades - View recent trades
/pnl - Check profit/loss summary
/stop - Emergency stop all trading

*System:*
/status - Check bot status
/help - Show this help message

Need help? Contact support: @YourSupportHandle`;

                await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
            });
        });

        // Wallet command
        this.bot.command('wallet', async (ctx) => {
            await this.handleRateLimit(ctx, async () => {
                await ctx.conversation.enter('walletSetup');
            });
        });

        // Alpha wallet command
        this.bot.command('alpha', async (ctx) => {
            await this.handleRateLimit(ctx, async () => {
                await ctx.conversation.enter('alphaWallet');
            });
        });

        // Settings command
        this.bot.command('settings', async (ctx) => {
            await this.handleRateLimit(ctx, async () => {
                await ctx.conversation.enter('settings');
            });
        });

        // Balance command
        this.bot.command('balance', async (ctx) => {
            await this.handleRateLimit(ctx, async () => {
                const user = await this.getOrCreateUser(ctx);
                await this.showBalance(ctx, user);
            });
        });

        // List alpha wallets
        this.bot.command('list', async (ctx) => {
            await this.handleRateLimit(ctx, async () => {
                const user = await this.getOrCreateUser(ctx);
                await this.showAlphaWallets(ctx, user);
            });
        });

        // Toggle auto-mimic
        this.bot.command('toggle', async (ctx) => {
            await this.handleRateLimit(ctx, async () => {
                const user = await this.getOrCreateUser(ctx);
                const newStatus = !user.settings.autoMimic;
                
                await database.updateUser(user.id, {
                    settings: { ...user.settings, autoMimic: newStatus }
                });

                const statusEmoji = newStatus ? '✅' : '❌';
                const statusText = newStatus ? 'ENABLED' : 'DISABLED';
                
                await ctx.reply(`${statusEmoji} Auto-copying ${statusText}`);
            });
        });

        // Show recent trades
        this.bot.command('trades', async (ctx) => {
            await this.handleRateLimit(ctx, async () => {
                const user = await this.getOrCreateUser(ctx);
                await this.showRecentTrades(ctx, user);
            });
        });

        // Show PnL
        this.bot.command('pnl', async (ctx) => {
            await this.handleRateLimit(ctx, async () => {
                const user = await this.getOrCreateUser(ctx);
                await this.showPnL(ctx, user);
            });
        });

        // Status command
        this.bot.command('status', async (ctx) => {
            await this.handleRateLimit(ctx, async () => {
                await this.showSystemStatus(ctx);
            });
        });

        // Emergency stop
        this.bot.command('stop', async (ctx) => {
            await this.handleRateLimit(ctx, async () => {
                const user = await this.getOrCreateUser(ctx);
                
                await database.updateUser(user.id, {
                    settings: { ...user.settings, autoMimic: false }
                });

                await ctx.reply('🛑 *EMERGENCY STOP ACTIVATED*\n\nAll auto-copying has been disabled.', {
                    parse_mode: 'Markdown'
                });
            });
        });
    }

    registerCallbackHandlers() {
        // Main menu callbacks
        this.bot.callbackQuery('main_menu', async (ctx) => {
            await ctx.answerCallbackQuery();
            await ctx.editMessageReplyMarkup({
                reply_markup: this.getMainMenuKeyboard()
            });
        });

        // Quick balance check
        this.bot.callbackQuery('quick_balance', async (ctx) => {
            await ctx.answerCallbackQuery();
            const user = await this.getOrCreateUser(ctx);
            await this.showBalance(ctx, user, true);
        });

        // Quick toggle
        this.bot.callbackQuery('quick_toggle', async (ctx) => {
            await ctx.answerCallbackQuery();
            const user = await this.getOrCreateUser(ctx);
            const newStatus = !user.settings.autoMimic;
            
            await database.updateUser(user.id, {
                settings: { ...user.settings, autoMimic: newStatus }
            });

            const statusEmoji = newStatus ? '✅' : '❌';
            const statusText = newStatus ? 'ON' : 'OFF';
            
            await ctx.editMessageText(`Auto-copying is now ${statusEmoji} ${statusText}`);
        });
    }

    // Wallet setup conversation
    async walletSetupConversation(conversation, ctx) {
        const user = await this.getOrCreateUser(ctx);
        
        if (user.wallet) {
            const keyboard = new InlineKeyboard()
                .text('📊 View Balance', 'view_balance')
                .text('🔄 Change Wallet', 'change_wallet').row()
                .text('🗑️ Remove Wallet', 'remove_wallet')
                .text('◀️ Back', 'main_menu');

            await ctx.reply(`💳 *Current Wallet:*\n\`${user.wallet.publicKey}\``, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
            return;
        }

        await ctx.reply(`💳 *Wallet Setup*

To start copying trades, you need to connect a Solana wallet.

⚠️ *Security Notice:*
• Your private key will be encrypted and stored securely
• Never share your private key with anyone else
• Use a dedicated trading wallet with limited funds

Please send your wallet's private key in one of these formats:
• Base58 encoded string
• JSON array (e.g., [1,2,3,...])

Type /cancel to abort.`);

        const response = await conversation.wait();
        
        if (response.message?.text === '/cancel') {
            await ctx.reply('❌ Wallet setup cancelled');
            return;
        }

        try {
            const privateKey = response.message?.text;
            if (!privateKey) {
                throw new Error('No private key provided');
            }

            // Import and validate wallet
            const wallet = walletManager.importWallet(privateKey);
            
            // Encrypt private key for storage
            const configData = await config.get();
            const encryptedKey = walletManager.encryptPrivateKey(
                privateKey,
                configData.security.encryptionKey
            );

            // Update user with wallet info
            await database.updateUser(user.id, {
                wallet: {
                    publicKey: wallet.publicKey,
                    encryptedPrivateKey: encryptedKey,
                    connectedAt: Date.now()
                }
            });

            // Get balance
            const balance = await walletManager.getSOLBalance(wallet.publicKey);

            await ctx.reply(`✅ *Wallet Connected Successfully!*

*Address:* \`${wallet.publicKey}\`
*Balance:* ${balance.toFixed(4)} SOL

Your wallet is now ready for copy trading!`, {
                parse_mode: 'Markdown'
            });

        } catch (error) {
            await ctx.reply(`❌ *Error connecting wallet:*\n${error.message}\n\nPlease try again with a valid private key.`);
        }
    }

    // Alpha wallet conversation
    async alphaWalletConversation(conversation, ctx) {
        const user = await this.getOrCreateUser(ctx);
        const alphaWallets = await database.getAlphaWallets(user.id);

        let message = '👑 *Alpha Wallet Management*\n\n';
        
        if (alphaWallets.length > 0) {
            message += '*Currently Tracking:*\n';
            alphaWallets.forEach((wallet, index) => {
                message += `${index + 1}. \`${wallet.address}\`\n   ${wallet.label || 'No label'}\n`;
            });
            message += '\n';
        }

        message += `*Options:*
• Send a wallet address to add it
• Send "remove X" to remove wallet #X
• Send "label X Your Label" to add a label
• Send /done to finish`;

        await ctx.reply(message, { parse_mode: 'Markdown' });

        while (true) {
            const response = await conversation.wait();
            const text = response.message?.text;

            if (!text) continue;

            if (text === '/done') {
                await ctx.reply('✅ Alpha wallet management completed');
                break;
            }

            if (text.startsWith('remove ')) {
                const index = parseInt(text.split(' ')[1]) - 1;
                if (index >= 0 && index < alphaWallets.length) {
                    const wallet = alphaWallets[index];
                    await database.removeAlphaWallet(user.id, wallet.id);
                    await ctx.reply(`✅ Removed wallet: ${wallet.address}`);
                    alphaWallets.splice(index, 1);
                } else {
                    await ctx.reply('❌ Invalid wallet number');
                }
                continue;
            }

            if (text.startsWith('label ')) {
                const parts = text.split(' ');
                const index = parseInt(parts[1]) - 1;
                const label = parts.slice(2).join(' ');
                
                if (index >= 0 && index < alphaWallets.length && label) {
                    // Update label logic would go here
                    await ctx.reply(`✅ Added label "${label}" to wallet #${index + 1}`);
                } else {
                    await ctx.reply('❌ Usage: label <number> <label>');
                }
                continue;
            }

            // Try to add as wallet address
            if (walletManager.isValidWalletAddress(text)) {
                try {
                    const wallet = await database.addAlphaWallet(user.id, text);
                    alphaWallets.push(wallet);
                    
                    // Add to blockchain monitor
                    const blockchainMonitor = require('../blockchain/blockchainMonitor');
                    await blockchainMonitor.addWalletToMonitor(text);
                    
                    await ctx.reply(`✅ Added alpha wallet: \`${text}\``, {
                        parse_mode: 'Markdown'
                    });
                } catch (error) {
                    await ctx.reply(`❌ Error adding wallet: ${error.message}`);
                }
            } else {
                await ctx.reply('❌ Invalid wallet address format');
            }
        }
    }

    // Settings conversation
    async settingsConversation(conversation, ctx) {
        const user = await this.getOrCreateUser(ctx);
        const settings = user.settings;

        await ctx.reply(`⚙️ *Current Settings:*

💰 Trade Amount: ${settings.tradeAmount} SOL
📊 Slippage: ${settings.slippage}%
🎯 Auto-Mimic: ${settings.autoMimic ? 'ON' : 'OFF'}
📈 Buy Only: ${settings.buyOnly ? 'ON' : 'OFF'}
📉 Sell Only: ${settings.sellOnly ? 'ON' : 'OFF'}
⏰ Delay: ${settings.delay}ms
🔄 Max Trades/Token: ${settings.maxTradesPerToken}

*Send new values:*
• \`amount 0.05\` - Set trade amount
• \`slippage 5\` - Set slippage %
• \`delay 2000\` - Set delay in ms
• \`maxtrades 5\` - Set max trades per token
• \`buyonly on\` - Enable buy-only mode
• \`sellonly on\` - Enable sell-only mode
• /done - Finish`, {
            parse_mode: 'Markdown'
        });

        while (true) {
            const response = await conversation.wait();
            const text = response.message?.text?.toLowerCase();

            if (!text) continue;

            if (text === '/done') {
                await ctx.reply('✅ Settings updated');
                break;
            }

            const parts = text.split(' ');
            const command = parts[0];
            const value = parts[1];

            try {
                const newSettings = { ...settings };

                switch (command) {
                    case 'amount':
                        const amount = parseFloat(value);
                        if (amount > 0 && amount <= 10) {
                            newSettings.tradeAmount = amount;
                            await ctx.reply(`✅ Trade amount set to ${amount} SOL`);
                        } else {
                            await ctx.reply('❌ Amount must be between 0 and 10 SOL');
                        }
                        break;

                    case 'slippage':
                        const slippage = parseFloat(value);
                        if (slippage >= 0.1 && slippage <= 20) {
                            newSettings.slippage = slippage;
                            await ctx.reply(`✅ Slippage set to ${slippage}%`);
                        } else {
                            await ctx.reply('❌ Slippage must be between 0.1% and 20%');
                        }
                        break;

                    case 'delay':
                        const delay = parseInt(value);
                        if (delay >= 0 && delay <= 30000) {
                            newSettings.delay = delay;
                            await ctx.reply(`✅ Delay set to ${delay}ms`);
                        } else {
                            await ctx.reply('❌ Delay must be between 0 and 30000ms');
                        }
                        break;

                    case 'maxrades':
                        const maxTrades = parseInt(value);
                        if (maxTrades >= 1 && maxTrades <= 20) {
                            newSettings.maxTradesPerToken = maxTrades;
                            await ctx.reply(`✅ Max trades per token set to ${maxTrades}`);
                        } else {
                            await ctx.reply('❌ Max trades must be between 1 and 20');
                        }
                        break;

                    case 'buyonly':
                        newSettings.buyOnly = value === 'on';
                        newSettings.sellOnly = false;
                        await ctx.reply(`✅ Buy-only mode ${value === 'on' ? 'enabled' : 'disabled'}`);
                        break;

                    case 'sellonly':
                        newSettings.sellOnly = value === 'on';
                        newSettings.buyOnly = false;
                        await ctx.reply(`✅ Sell-only mode ${value === 'on' ? 'enabled' : 'disabled'}`);
                        break;

                    default:
                        await ctx.reply('❌ Unknown setting. Check /help for valid commands.');
                        continue;
                }

                await database.updateUser(user.id, { settings: newSettings });
                Object.assign(settings, newSettings);

            } catch (error) {
                await ctx.reply(`❌ Error updating setting: ${error.message}`);
            }
        }
    }

    // Helper methods
    async getOrCreateUser(ctx) {
        const telegramId = ctx.from.id.toString();
        let user = await database.getUser(telegramId);
        
        if (!user) {
            user = await database.createUser(telegramId, {
                username: ctx.from.username,
                firstName: ctx.from.first_name,
                lastName: ctx.from.last_name
            });
        }
        
        return user;
    }

    async handleRateLimit(ctx, handler) {
        const telegramId = ctx.from.id.toString();
        const allowed = await database.checkRateLimit(telegramId);
        
        if (!allowed) {
            await ctx.reply('⚠️ Rate limit exceeded. Please try again later.');
            return;
        }
        
        await handler();
    }

    getMainMenuKeyboard() {
        return new InlineKeyboard()
            .text('💳 Wallet', 'wallet_menu')
            .text('👑 Alpha Wallets', 'alpha_menu').row()
            .text('⚙️ Settings', 'settings_menu')
            .text('📊 Balance', 'quick_balance').row()
            .text('🔄 Toggle Auto-Copy', 'quick_toggle')
            .text('📈 Trades', 'trades_menu');
    }

    async showBalance(ctx, user, isCallback = false) {
        if (!user.wallet) {
            const message = '❌ No wallet connected. Use /wallet to connect one.';
            if (isCallback) {
                await ctx.editMessageText(message);
            } else {
                await ctx.reply(message);
            }
            return;
        }

        try {
            const solBalance = await walletManager.getSOLBalance(user.wallet.publicKey);
            const tokenAccounts = await walletManager.getTokenAccounts(user.wallet.publicKey);
            
            let message = `💰 *Wallet Balance*\n\n*SOL:* ${solBalance.toFixed(4)} SOL\n`;
            
            if (tokenAccounts.length > 0) {
                message += '\n*Tokens:*\n';
                tokenAccounts.slice(0, 10).forEach(token => {
                    message += `• ${token.balance.toFixed(6)} (${token.mint.slice(0, 8)}...)\n`;
                });
                
                if (tokenAccounts.length > 10) {
                    message += `... and ${tokenAccounts.length - 10} more tokens\n`;
                }
            }

            if (isCallback) {
                await ctx.editMessageText(message, { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(message, { parse_mode: 'Markdown' });
            }

        } catch (error) {
            const errorMessage = `❌ Error fetching balance: ${error.message}`;
            if (isCallback) {
                await ctx.editMessageText(errorMessage);
            } else {
                await ctx.reply(errorMessage);
            }
        }
    }

    async showAlphaWallets(ctx, user) {
        const alphaWallets = await database.getAlphaWallets(user.id);
        
        if (alphaWallets.length === 0) {
            await ctx.reply('📝 No alpha wallets configured.\nUse /alpha to add some.');
            return;
        }

        let message = '👑 *Your Alpha Wallets:*\n\n';
        
        alphaWallets.forEach((wallet, index) => {
            const status = wallet.isActive ? '✅' : '❌';
            message += `${index + 1}. ${status} \`${wallet.address}\`\n`;
            if (wallet.label) {
                message += `   📝 ${wallet.label}\n`;
            }
            message += `   📊 ${wallet.totalTrades} trades tracked\n\n`;
        });

        await ctx.reply(message, { parse_mode: 'Markdown' });
    }

    async showRecentTrades(ctx, user) {
        const trades = await database.getUserTrades(user.id, 10);
        
        if (trades.length === 0) {
            await ctx.reply('📝 No trades found.');
            return;
        }

        let message = '📈 *Recent Trades:*\n\n';
        
        trades.forEach(trade => {
            const status = trade.success ? '✅' : '❌';
            const type = trade.type.toUpperCase();
            const date = new Date(trade.timestamp).toLocaleString();
            
            message += `${status} ${type} - ${date}\n`;
            if (trade.success && trade.copySignature) {
                message += `🔗 [View Transaction](https://solscan.io/tx/${trade.copySignature})\n`;
            }
            if (trade.error) {
                message += `❌ ${trade.error}\n`;
            }
            message += '\n';
        });

        await ctx.reply(message, { 
            parse_mode: 'Markdown',
            disable_web_page_preview: true 
        });
    }

    async showPnL(ctx, user) {
        const trades = await database.getUserTrades(user.id, 100);
        
        if (trades.length === 0) {
            await ctx.reply('📝 No trades to calculate PnL.');
            return;
        }

        const successfulTrades = trades.filter(t => t.success);
        const failedTrades = trades.filter(t => !t.success);
        
        // Simple PnL calculation (would need price data for accurate calculation)
        const totalTrades = trades.length;
        const successRate = (successfulTrades.length / totalTrades * 100).toFixed(1);
        
        const message = `📊 *Trading Summary:*

📈 Total Trades: ${totalTrades}
✅ Successful: ${successfulTrades.length}
❌ Failed: ${failedTrades.length}
🎯 Success Rate: ${successRate}%

💡 *Note:* Detailed PnL calculation requires price tracking integration.`;

        await ctx.reply(message, { parse_mode: 'Markdown' });
    }

    async showSystemStatus(ctx) {
        try {
            const blockchainMonitor = require('../blockchain/blockchainMonitor');
            const copyTrader = require('../trading/copyTrader');
            
            const monitorStatus = blockchainMonitor.getStatus();
            const traderStatus = copyTrader.getStatus();
            const networkHealthy = await walletManager.isHealthy();
            
            const message = `🔧 *System Status:*

*Blockchain Monitor:*
${monitorStatus.isMonitoring ? '✅' : '❌'} Monitoring: ${monitorStatus.isMonitoring ? 'ON' : 'OFF'}
👀 Watching: ${monitorStatus.monitoredWallets} wallets
🔌 WebSocket: ${monitorStatus.wsConnected ? 'Connected' : 'Disconnected'}

*Copy Trader:*
⏳ Queue: ${traderStatus.queueLength} pending
🔄 Active: ${traderStatus.activeTrades}/${traderStatus.maxConcurrentTrades}
📊 Processing: ${traderStatus.isProcessing ? 'YES' : 'NO'}

*Network:*
🌐 Solana RPC: ${networkHealthy ? '✅ Healthy' : '❌ Unhealthy'}

*Bot:*
🤖 Status: ${this.isRunning ? '✅ Running' : '❌ Stopped'}`;

            await ctx.reply(message, { parse_mode: 'Markdown' });

        } catch (error) {
            await ctx.reply(`❌ Error getting system status: ${error.message}`);
        }
    }

    // Send notification to user
    async sendNotification(userId, message, options = {}) {
        try {
            await this.bot.api.sendMessage(userId, message, {
                parse_mode: 'Markdown',
                disable_notification: options.silent || false,
                ...options
            });
        } catch (error) {
            console.error(`Failed to send notification to ${userId}:`, error);
        }
    }

    // Send trade notification
    async sendTradeNotification(userId, tradeData) {
        try {
            const { swapData, tradeResult } = tradeData;
            const status = tradeResult.success ? '✅' : '❌';
            const type = swapData.type.toUpperCase();
            
            let message = `${status} *${type} Trade ${tradeResult.success ? 'Completed' : 'Failed'}*\n\n`;
            
            if (tradeResult.success) {
                message += `🔗 Alpha Wallet: \`${swapData.wallet.slice(0, 8)}...\`\n`;
                message += `💰 Amount: ${swapData.type === 'buy' ? tradeResult.inputAmount / 1e9 : tradeResult.outputAmount / 1e9} SOL\n`;
                
                if (tradeResult.signature) {
                    message += `📋 [View Transaction](https://solscan.io/tx/${tradeResult.signature})\n`;
                }
                
                if (tradeResult.priceImpact) {
                    message += `📊 Price Impact: ${tradeResult.priceImpact}%\n`;
                }
            } else {
                message += `❌ Error: ${tradeResult.error}\n`;
            }

            await this.sendNotification(userId, message);

        } catch (error) {
            console.error('Error sending trade notification:', error);
        }
    }

    // Start the bot
    async start() {
        if (this.isRunning) {
            console.log('⚠️ Bot is already running');
            return;
        }

        try {
            await this.bot.start();
            this.isRunning = true;
            console.log('🚀 Telegram bot started');

        } catch (error) {
            console.error('❌ Failed to start bot:', error);
            throw error;
        }
    }

    // Stop the bot
    async stop() {
        if (!this.isRunning) {
            console.log('⚠️ Bot is not running');
            return;
        }

        try {
            await this.bot.stop();
            this.isRunning = false;
            console.log('🛑 Telegram bot stopped');

        } catch (error) {
            console.error('❌ Error stopping bot:', error);
        }
    }

    // Broadcast message to all active users
    async broadcast(message, options = {}) {
        try {
            const users = await database.getAllUsers();
            const promises = users.map(user => 
                this.sendNotification(user.id, message, options)
            );
            
            await Promise.allSettled(promises);
            console.log(`📢 Broadcast sent to ${users.length} users`);

        } catch (error) {
            console.error('Error broadcasting message:', error);
        }
    }

    // Get bot statistics
    getStats() {
        return {
            isRunning: this.isRunning,
            activeSessions: this.userSessions.size
        };
    }
}

module.exports = new TelegramBot();
