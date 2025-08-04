# copi Alpha
Solana Alpha Wallet Copy Trading Bot

A sophisticated Solana trading bot that tracks "alpha" wallets (high-performing traders) and automatically mimics their buy/sell actions in real-time through Telegram.

## Features
get in here https://t.me/copiAlpha_bot

🚀 **Real-time Monitoring**: Tracks Solana blockchain for token swaps from configured alpha wallets
📱 **Telegram Integration**: Full bot interface using Grammy framework
💰 **Automated Trading**: Executes matching trades using Jupiter Aggregator
⚙️ **Configurable Settings**: Customize trade amounts, slippage, delays, and filters
🔒 **Secure**: Encrypted private key storage with rate limiting
📊 **Trade Tracking**: Comprehensive logging and PnL tracking

## Architecture

The bot is built with a modular architecture:

- **Config Manager**: Handles configuration and environment variables
- **Database**: JSON-based storage for users, wallets, and trades
- **Wallet Manager**: Solana wallet operations and balance checking
- **Blockchain Monitor**: Real-time transaction monitoring via WebSocket
- **Jupiter Trader**: DEX integration for executing swaps
- **Copy Trader**: Core logic for mimicking alpha wallet trades
- **Telegram Bot**: User interface and notifications

## Prerequisites

- Node.js 16+ 
- A Telegram Bot Token (from @BotFather)
- Solana RPC endpoint (free options available)
- Helius WebSocket URL (for real-time monitoring)

## Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd solana-alpha-wallet-bot
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
```

Edit `.env` file with your configuration:
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
HELIUS_WS_URL=wss://atlas-mainnet.helius-rpc.com
ENCRYPTION_KEY=your-32-character-encryption-key!!!
```

4. **Start the bot**
```bash
npm start
```

For development:
```bash
npm run dev
```

## Getting Required APIs

### 1. Telegram Bot Token
1. Message @BotFather on Telegram
2. Send `/newbot` and follow instructions
3. Copy the token to your `.env` file

### 2. Helius WebSocket (Recommended)
1. Sign up at [Helius.xyz](https://www.helius.xyz/)
2. Get your WebSocket URL from the dashboard
3. Replace in `.env` file

### 3. Solana RPC (Multiple Options)
- **Free**: `https://api.mainnet-beta.solana.com`
- **Helius**: Include your API key in URL
- **QuickNode**: Sign up for dedicated endpoint
- **Alchemy**: Solana API endpoints

## Usage

### 1. Initial Setup
1. Start a chat with your bot on Telegram
2. Send `/start` to initialize
3. Use `/wallet` to connect your trading wallet
4. Use `/alpha` to add alpha wallets to track

### 2. Configuration
Use `/settings` to configure:
- **Trade Amount**: How much SOL to trade per signal
- **Slippage**: Maximum slippage tolerance (%)
- **Delay**: Optional delay before copying trades (ms)
- **Max Trades**: Maximum trades per token to prevent spam
- **Buy/Sell Only**: Copy only buy or sell signals

### 3. Available Commands
- `/start` - Initialize bot and show welcome
- `/wallet` - Connect/manage trading wallet  
- `/alpha` - Add/remove alpha wallets to track
- `/settings` - Configure trading parameters
- `/balance` - Check wallet balances
- `/list` - Show tracked alpha wallets
- `/toggle` - Enable/disable auto-copying
- `/trades` - View recent trade history
- `/pnl` - Show profit/loss summary
- `/status` - Check system status
- `/stop` - Emergency stop all trading
- `/help` - Show help message

## Security Considerations

🔒 **Private Key Security**
- Private keys are encrypted using AES-256
- Never share your encryption key
- Use dedicated trading wallets with limited funds
- Regularly rotate encryption keys

🛡️ **Rate Limiting**
- Built-in rate limiting prevents abuse
- Configurable request limits per user
- Automatic cleanup of old data

⚡ **Risk Management**
- Set reasonable trade amounts
- Use stop-loss mechanisms
- Monitor trades regularly
- Test with small amounts first

## Configuration Options

### Environment Variables
```env
# Required
TELEGRAM_BOT_TOKEN=            # Your Telegram bot token
SOLANA_RPC_URL=               # Solana RPC endpoint
HELIUS_WS_URL=                # WebSocket for real-time data
ENCRYPTION_KEY=               # 32-character encryption key

# Optional
NODE_ENV=production           # Environment mode
LOG_LEVEL=info               # Logging level
MAX_CONCURRENT_TRADES=3      # Max simultaneous trades
```

### User Settings
Each user can configure:
- Trade amount (0.001 - 10 SOL)
- Slippage tolerance (0.1% - 20%)
- Copy delay (0 - 30 seconds)
- Max trades per token (1 - 20)
- Buy/sell only modes
- Auto-mimic on/off

## File Structure

```
├── config/
│   └── config.js           # Configuration management
├── database/
│   └── database.js         # JSON database operations
├── wallet/
│   └── walletManager.js    # Solana wallet operations
├── blockchain/
│   └── blockchainMonitor.js # Real-time monitoring
├── trading/
│   ├── jupiterTrader.js    # DEX integration
│   └── copyTrader.js       # Copy trading logic
├── telegram/
│   └── telegramBot.js      # Telegram bot interface
├── data/                   # JSON database files
├── index.js               # Main application
├── package.json
└── .env                   # Environment variables
```

## Development

### Adding New Features
1. Create feature branch
2. Add module in appropriate directory
3. Update main index.js if needed
4. Test thoroughly on testnet
5. Submit pull request

### Testing
```bash
# Test individual components
node -e "require('./wallet/walletManager').isHealthy().then(console.log)"

# Test with small amounts first
# Use Solana devnet for testing
```

### Debugging
```bash
# Check system status
node index.js status

# Restart specific service
node index.js restart monitor

# Send broadcast message
node index.js broadcast "System maintenance in 10 minutes"
```

## Common Issues

### 1. WebSocket Connection Failed
- Check Helius URL and API key
- Verify network connectivity
- Try alternative WebSocket providers

### 2. Jupiter API Errors
- Check if token is supported
- Verify slippage settings
- Ensure sufficient balance

### 3. Transaction Failures
- Increase slippage tolerance
- Check network congestion
- Verify wallet has enough SOL for fees

### 4. Bot Not Responding
- Check Telegram token
- Verify bot permissions
- Check rate limiting

## Performance Optimization

### 1. RPC Selection
- Use dedicated RPC endpoints for better performance
- Consider geo-location for lower latency
- Implement RPC rotation for reliability

### 2. Database Optimization
- Regular cleanup of old data
- Consider external database for scale
- Index frequently queried fields

### 3. Memory Management
- Monitor memory usage
- Clear old trade counters
- Restart bot periodically if needed

## Monitoring and Alerts

The bot includes built-in monitoring:
- Health checks every 5 minutes  
- Hourly status reports
- Automatic service restarts on failure
- Trade success/failure notifications
- System resource monitoring

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer

⚠️ **Important Notice**

This bot is for educational and research purposes. Cryptocurrency trading involves significant risk:

- **Financial Risk**: You may lose all invested funds
- **Technical Risk**: Bugs or failures could cause losses
- **Market Risk**: Crypto markets are highly volatile
- **Regulatory Risk**: Trading regulations vary by jurisdiction

**Use at your own risk. The developers are not responsible for any financial losses.**

## Support

- 📧 Email: support@yourbot.com
- 💬 Telegram: @YourSupportChannel
- 🐛 Issues: GitHub Issues page
- 📖 Documentation: Wiki section

## Roadmap

### Phase 1 (Current)
- ✅ Basic copy trading functionality
- ✅ Telegram bot interface
- ✅ Jupiter DEX integration
- ✅ Real-time monitoring

### Phase 2 (Planned)
- 🔄 Advanced filtering options
- 🔄 Portfolio management
- 🔄 Multiple DEX support
- 🔄 Web dashboard

### Phase 3 (Future)
- 🔄 AI-powered trade analysis
- 🔄 Social trading features
- 🔄 Mobile app
- 🔄 Advanced analytics

## Acknowledgments

- [Solana Foundation](https://solana.org/) for the blockchain infrastructure
- [Jupiter](https://jup.ag/) for DEX aggregation
- [Grammy](https://grammy.dev/) for Telegram bot framework
- [Helius](https://www.helius.xyz/) for real-time data services

---

*Built with ❤️ for the Solana community*