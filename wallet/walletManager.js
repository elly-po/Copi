// walletManager.js

import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction
} from '@solana/web3.js';

import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';

import bs58 from 'bs58';
import crypto from 'crypto';
import config from '../config/config.js';

class WalletManager {
  constructor() {
    this.connection = null;
    this.initializeConnection();
  }

  async initializeConnection() {
    try {
      const configData = await config.get();
      this.connection = new Connection(
        configData.solana.rpcUrl,
        configData.solana.commitment
      );

      const version = await this.connection.getVersion();
      console.log('✅ Solana connection established, version:', version['solana-core']);
    } catch (error) {
      console.error('❌ Failed to connect to Solana:', error);
      throw error;
    }
  }

  encryptPrivateKey(privateKey, encryptionKey) {
    const cipher = crypto.createCipher('aes256', encryptionKey);
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  decryptPrivateKey(encryptedKey, encryptionKey) {
    const decipher = crypto.createDecipher('aes256', encryptionKey);
    let decrypted = decipher.update(encryptedKey, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  importWallet(privateKeyString) {
    try {
      let secretKey;
      try {
        secretKey = bs58.decode(privateKeyString);
      } catch (e) {
        secretKey = new Uint8Array(JSON.parse(privateKeyString));
      }

      const keypair = Keypair.fromSecretKey(secretKey);
      return {
        publicKey: keypair.publicKey.toString(),
        keypair
      };
    } catch (error) {
      console.error('Error importing wallet:', error);
      throw new Error('Invalid private key format. Use base58 or JSON array format.');
    }
  }

  generateWallet() {
    const keypair = Keypair.generate();
    return {
      publicKey: keypair.publicKey.toString(),
      privateKey: bs58.encode(keypair.secretKey),
      keypair
    };
  }

  async getSOLBalance(publicKey) {
    try {
      const pubKey = new PublicKey(publicKey);
      const balance = await this.connection.getBalance(pubKey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Error getting SOL balance:', error);
      return 0;
    }
  }

  async getTokenBalance(walletPublicKey, mintAddress) {
    try {
      const walletPubKey = new PublicKey(walletPublicKey);
      const mintPubKey = new PublicKey(mintAddress);

      const tokenAccountAddress = await getAssociatedTokenAddress(
        mintPubKey,
        walletPubKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const tokenAccountInfo = await this.connection.getTokenAccountBalance(tokenAccountAddress);

      if (tokenAccountInfo.value) {
        return {
          balance: tokenAccountInfo.value.amount,
          decimals: tokenAccountInfo.value.decimals,
          uiAmount: tokenAccountInfo.value.uiAmount
        };
      }

      return { balance: '0', decimals: 9, uiAmount: 0 };
    } catch (error) {
      console.error('Error getting token balance:', error);
      return { balance: '0', decimals: 9, uiAmount: 0 };
    }
  }

  async getTokenAccounts(publicKey) {
    try {
      const pubKey = new PublicKey(publicKey);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        pubKey,
        { programId: TOKEN_PROGRAM_ID }
      );

      return tokenAccounts.value.map(account => ({
        mint: account.account.data.parsed.info.mint,
        balance: account.account.data.parsed.info.tokenAmount.uiAmount,
        decimals: account.account.data.parsed.info.tokenAmount.decimals
      })).filter(token => token.balance > 0);
    } catch (error) {
      console.error('Error getting token accounts:', error);
      return [];
    }
  }

  isValidWalletAddress(address) {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  async getTransactionHistory(publicKey, limit = 20) {
    try {
      const pubKey = new PublicKey(publicKey);
      const signatures = await this.connection.getSignaturesForAddress(pubKey, { limit });

      const transactions = [];
      for (const sig of signatures) {
        try {
          const tx = await this.connection.getParsedTransaction(
            sig.signature,
            { maxSupportedTransactionVersion: 0 }
          );

          if (tx) {
            transactions.push({
              signature: sig.signature,
              slot: tx.slot,
              blockTime: tx.blockTime,
              fee: tx.meta?.fee,
              status: tx.meta?.err ? 'failed' : 'success',
              instructions: tx.transaction?.message?.instructions?.length || 0
            });
          }
        } catch (e) {
          console.error('Error fetching transaction:', e);
        }
      }

      return transactions;
    } catch (error) {
      console.error('Error getting transaction history:', error);
      return [];
    }
  }

  async getRecentSwaps(publicKey, limit = 10) {
    try {
      const pubKey = new PublicKey(publicKey);
      const signatures = await this.connection.getSignaturesForAddress(pubKey, { limit: limit * 2 });

      const swaps = [];
      for (const sig of signatures) {
        try {
          const tx = await this.connection.getParsedTransaction(
            sig.signature,
            { maxSupportedTransactionVersion: 0 }
          );

          if (tx && tx.meta && !tx.meta.err) {
            const preTokenBalances = tx.meta.preTokenBalances || [];
            const postTokenBalances = tx.meta.postTokenBalances || [];

            if (preTokenBalances.length > 0 || postTokenBalances.length > 0) {
              swaps.push({
                signature: sig.signature,
                slot: tx.slot,
                blockTime: tx.blockTime,
                fee: tx.meta.fee,
                preTokenBalances,
                postTokenBalances
              });
            }
          }
        } catch (e) {
          console.error('Error processing swap transaction:', e);
        }

        if (swaps.length >= limit) break;
      }

      return swaps;
    } catch (error) {
      console.error('Error getting recent swaps:', error);
      return [];
    }
  }

  async sendSOL(fromKeypair, toPublicKey, amount) {
    try {
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: fromKeypair.publicKey,
          toPubkey: new PublicKey(toPublicKey),
          lamports: amount * LAMPORTS_PER_SOL
        })
      );

      const signature = await this.connection.sendTransaction(transaction, [fromKeypair], {
        skipPreflight: false,
        preflightCommitment: 'processed'
      });

      await this.connection.confirmTransaction(signature, 'confirmed');
      return signature;
    } catch (error) {
      console.error('Error sending SOL:', error);
      throw error;
    }
  }

  async getNetworkStats() {
    try {
      const epochInfo = await this.connection.getEpochInfo();
      const recentBlockhash = await this.connection.getLatestBlockhash();
      const version = await this.connection.getVersion();

      return {
        epoch: epochInfo.epoch,
        slotIndex: epochInfo.slotIndex,
        slotsInEpoch: epochInfo.slotsInEpoch,
        blockHeight: recentBlockhash.lastValidBlockHeight,
        solanaVersion: version['solana-core']
      };
    } catch (error) {
      console.error('Error getting network stats:', error);
      return null;
    }
  }

  async isHealthy() {
    try {
      const health = await this.connection.getHealth();
      return health === 'ok';
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }
}

const walletManager = new WalletManager();
export default walletManager;