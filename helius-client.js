require('dotenv').config();
const EventEmitter = require('events');
const WebSocket = require('ws');
const { Connection } = require('@solana/web3.js');

class HeliusClient extends EventEmitter {
  constructor(wallets = []) {
    super();

    this.trackedWallets = wallets;
    this.wsURL = `wss://rpc.helius.xyz/?api-key=${process.env.HELIUS_API_KEY}`;
    this.publicRPC = new Connection('https://api.mainnet-beta.solana.com');
    this.ws = null;
    this.backoff = 0;

    console.log('🧠 [HeliusClient] Initialized');
    console.log(`🔗 WS Endpoint: ${this.wsURL}`);
    console.log(`🔗 Public RPC: ${this.publicRPC._rpcEndpoint}`);
  }

  async start() {
    console.log('🚀 [HeliusClient] Starting WebSocket listener...');
    this.ws = new WebSocket(this.wsURL);

    this.ws.on('open', () => {
      console.log('✅ [WS] Connected to Helius');

      if (this.trackedWallets.length > 0) {
        const subscription = {
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'logsSubscribe',
          params: [{ mentions: this.trackedWallets }, { commitment: 'processed' }]
        };
        this.ws.send(JSON.stringify(subscription));
        console.log(`📡 [WS] Batched subscription for ${this.trackedWallets.length} wallets`);
      } else {
        console.log('⚠️ [WS] No wallets to track');
      }

      this.backoff = 0; // Reset backoff on success
    });

    this.ws.on('message', async (message) => {
      const payload = JSON.parse(message);
      const signature = payload?.params?.result?.value?.signature;
      if (!signature) return;

      console.log(`🧠 [WS] Tx signature received: ${signature}`);
      await this.handleSignature(signature);
    });

    this.ws.on('close', () => {
      console.warn('⚠️ [WS] Connection closed. Reconnecting...');
      this.backoff = Math.min(this.backoff + 1000, 30000); // exponential backoff capped at 30s
      setTimeout(() => this.start(), this.backoff);
    });

    this.ws.on('error', (error) => {
      console.error('❌ [WS] Error:', error.message);
    });
  }

  async handleSignature(signature) {
    console.log(`🔎 [RPC] Fetching transaction for ${signature}`);
    try {
      const tx = await this.publicRPC.getParsedTransaction(signature, 'processed');

      if (!tx || !tx.transaction) {
        console.warn(`⚠️ [RPC] Transaction not found: ${signature}`);
        return;
      }

      const swapSignal = this.parseSwap(tx);
      if (swapSignal) {
        console.log(`📈 [Signal] Swap detected: ${swapSignal.tokenIn} → ${swapSignal.tokenOut}`);
        this.emit('tradeSignal', swapSignal);
      } else {
        console.log(`🔕 [Signal] No swap intent found in ${signature}`);
      }
    } catch (err) {
      console.error(`❌ [RPC] Error fetching transaction:`, err.message);
    }
  }

  parseSwap(tx) {
    console.log('🧪 [Parser] Parsing swap intent...');
    const instructions = tx?.transaction?.message?.instructions || [];
    if (!instructions.length) {
      console.log('⚠️ [Parser] No instructions found');
      return null;
    }

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

      if (program === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4') {
        swapSignal.protocol = 'Jupiter';
      } else if (program === '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM') {
        swapSignal.protocol = 'Raydium';
      } else if (program === 'EhpHV7B2r4F4zHF2qNpANKKLNEtCT6Z6LNHNz8Xr8kLJ') {
        swapSignal.protocol = 'Orca';
      }

      if (accounts.length >= 4) {
        swapSignal.tokenIn = accounts[2];
        swapSignal.tokenOut = accounts[3];
        console.log(`✅ [Parser] Protocol=${swapSignal.protocol}, tokenIn=${swapSignal.tokenIn}, tokenOut=${swapSignal.tokenOut}`);
        break;
      }
    }

    return swapSignal.tokenIn && swapSignal.tokenOut ? swapSignal : null;
  }

  async addWallet(address) {
    if (!this.trackedWallets.includes(address)) {
      this.trackedWallets.push(address);
      console.log(`➕ [Tracker] Wallet added: ${address}`);
    }
  }

  async stop() {
    if (this.ws) {
      console.log('🛑 [HeliusClient] Closing WebSocket...');
      this.ws.close();
    }
  }

  getTrackedWallets() {
    return this.trackedWallets;
  }
}

module.exports = HeliusClient;