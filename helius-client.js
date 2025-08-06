require('dotenv').config();
const EventEmitter = require('events');
const WebSocket = require('ws');
const { Connection } = require('@solana/web3.js');

class HeliusClient extends EventEmitter {
  constructor(wallets = []) {
    super();

    this.trackedWallets = wallets;

    // ✅ Hardcoded high-churn wallet for keepalive activity
    this.keepAliveWallets = [
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' // Jupiter Router
    ];

    this.wsURL = `wss://rpc.helius.xyz/?api-key=${process.env.HELIUS_API_KEY}`;
    this.publicRPC = new Connection('https://api.mainnet-beta.solana.com');
    this.ws = null;
    this.backoff = 0;
    this.heartbeatInterval = null;

    this.telemetry = {
      signalsReceived: 0,
      keepAliveHits: 0,
      lastSignalTime: null
    };

    console.log('🧠 [HeliusClient] Initialized');
    console.log(`🔗 WS Endpoint: ${this.wsURL}`);
    console.log(`🔗 Public RPC: ${this.publicRPC._rpcEndpoint}`);
  }

  async start() {
    console.log('🚀 [HeliusClient] Starting WebSocket listener...');
    this.ws = new WebSocket(this.wsURL);

    this.ws.on('open', () => {
      console.log('✅ [WS] Connected to Helius');

      const allWallets = [...this.trackedWallets, ...this.keepAliveWallets];
      if (allWallets.length === 0) {
        console.log('⚠️ [WS] No wallets to subscribe');
        return;
      }

      const subscription = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'logsSubscribe',
        params: [{ mentions: allWallets }, { commitment: 'processed' }]
      };

      this.ws.send(JSON.stringify(subscription));
      console.log(`📡 [WS] Subscribed to ${allWallets.length} wallets`);

      this.backoff = 0;

      this.heartbeatInterval = setInterval(() => {
        const lastSeen = this.telemetry.lastSignalTime
          ? new Date(this.telemetry.lastSignalTime).toLocaleTimeString()
          : 'None';
        console.log(`🟢 [Heartbeat] Alpha=${this.trackedWallets.length}, KeepAlive=${this.keepAliveWallets.length}, Signals=${this.telemetry.signalsReceived}, KeepAliveHits=${this.telemetry.keepAliveHits}, LastSignal=${lastSeen}`);
      }, 300000);
    });

    this.ws.on('message', async (message) => {
      const payload = JSON.parse(message);
      const signature = payload?.params?.result?.value?.signature;
      const mentionedWallet = payload?.params?.result?.value?.mentions?.[0];
      const rawLog = payload?.params?.result?.value?.logs;
      
      if (Array.isArray(rawLog)) {
        console.log(`🧾 [Raw Logs] ${rawLog.join(' | ')} | [signature] ${signature}`);
      } else {
        console.warn('⚠️ No logs found in payload:', payload);
      }

      if (!signature || !mentionedWallet) return;

      const isAlpha = this.trackedWallets.includes(mentionedWallet);
      const isKeepAlive = this.keepAliveWallets.includes(mentionedWallet);

      if (isAlpha) {
        this.telemetry.signalsReceived++;
        this.telemetry.lastSignalTime = Date.now();
        console.log(`🧠 [Alpha] ${mentionedWallet} emitted tx: ${signature}`);
        await this.handleSignature(signature, mentionedWallet);
      } else if (isKeepAlive) {
        this.telemetry.keepAliveHits++;
        console.log(`⚙️ [KeepAlive] Activity from ${mentionedWallet}: ${signature}`);
      }
    });

    this.ws.on('close', () => {
      console.warn('⚠️ [WS] Connection closed. Reconnecting...');
      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
      this.backoff = Math.min(this.backoff + 1000, 30000);
      setTimeout(() => this.start(), this.backoff);
    });

    this.ws.on('error', (err) => {
      console.error('❌ [WS] Error:', err.message);
    });
  }

  async handleSignature(signature, alphaWallet) {
    console.log(`🔎 [RPC] Fetching tx for signature: ${signature}`);
    console.log(`👤 [Alpha Wallet]: ${alphaWallet}`);

    try {
      const tx = await this.publicRPC.getParsedTransaction(signature, 'processed');

      if (!tx || !tx.transaction) {
        console.warn(`⚠️ [RPC] No transaction found`);
        return;
      }

      console.log(`📄 [RPC] Parsed Transaction: ${JSON.stringify(tx.transaction.message, null, 2)}`);
      console.log(`📊 [AccountKeys]:`, tx.transaction.message.accountKeys.map(k => k.pubkey.toBase58()));
      console.log(`🕓 [BlockTime]: ${tx.blockTime}`);
      console.log(`📋 [Instruction Count]: ${tx.transaction.message.instructions.length}`);

      const swapSignal = this.parseSwap(tx);
      if (swapSignal) {
        swapSignal.alphaWallet = alphaWallet;
        console.log(`📈 [Signal] ${swapSignal.tokenIn} → ${swapSignal.tokenOut}`);
        console.log(`🚨 [Emit Signal]`, JSON.stringify(swapSignal, null, 2));
        this.emit('tradeSignal', swapSignal);
      } else {
        console.log(`🔕 [No swap detected]`);
      }
    } catch (err) {
      console.error(`❌ [RPC Error]:`, err.message);
    }
  }

  parseSwap(tx) {
    console.log('🧪 [Parser] Scanning instructions...');
    const instructions = tx?.transaction?.message?.instructions || [];
    if (!instructions.length) {
      console.log('⚠️ [Parser] No instructions');
      return null;
    }

    console.log('📦 [Raw Instructions]', JSON.stringify(instructions, null, 2));

    const swapSignal = {
      signature: tx.transaction.signatures[0],
      timestamp: tx.blockTime || Date.now(),
      protocol: null,
      tokenIn: null,
      tokenOut: null,
      tokenSymbol: null
    };

    for (const ix of instructions) {
      const program = ix.programId?.toBase58?.();
      const accounts = ix.accounts?.map(a => a.toBase58?.()) || [];

      if (program === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4') swapSignal.protocol = 'Jupiter';
      else if (program === '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM') swapSignal.protocol = 'Raydium';
      else if (program === 'EhpHV7B2r4F4zHF2qNpANKKLNEtCT6Z6LNHNz8Xr8kLJ') swapSignal.protocol = 'Orca';

      if (accounts.length >= 4) {
        swapSignal.tokenIn = accounts[2];
        swapSignal.tokenOut = accounts[3];
        console.log(`✅ [Detected] Protocol=${swapSignal.protocol}, In=${swapSignal.tokenIn}, Out=${swapSignal.tokenOut}`);
        break;
      }
    }

    return swapSignal.tokenIn && swapSignal.tokenOut ? swapSignal : null;
  }

  async addWallet(address) {
    if (!this.trackedWallets.includes(address)) {
      this.trackedWallets.push(address);
      console.log(`➕ [Alpha Tracker Added]: ${address}`);
    }
  }

  async stop() {
    if (this.ws) {
      console.log('🛑 [WS] Closing...');
      this.ws.close();
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    console.log('🛑 [HeliusClient] Stopped');
  }

  getTrackedWallets() {
    return this.trackedWallets;
  }
}

module.exports = HeliusClient;
