// utils/transactionParser.js

import { Connection } from '@solana/web3.js';
import config from '../config/index.js';

const JUPITER_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

export async function parseSwapTransaction(txSignature) {
  try {
    const connection = new Connection(config.solana.rpcUrl);

    const tx = await connection.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: 0
    });

    if (!tx?.meta?.innerInstructions) return null;

    const swapInstruction = tx.meta.innerInstructions
      .flatMap(i => i.instructions)
      .find(i => i.programId?.toBase58() === JUPITER_PROGRAM_ID);

    if (!swapInstruction) return null;

    const { inputMint, outputMint, inAmount, outAmount } = swapInstruction.parsed.info;

    return {
      txSignature,
      inputMint,
      outputMint,
      inputAmount: inAmount,
      outputAmount: outAmount,
      isBuy: isBuyOrder(inputMint), // Heuristic
      timestamp: tx.blockTime * 1000,
      fee: tx.meta.fee
    };
  } catch (error) {
    console.error('Parse error:', error);
    return null;
  }
}

// Simple buy/sell heuristic (you can refine this logic)
function isBuyOrder(inputMint) {
  // Add known stablecoin mints here to detect buys (e.g., USDC, USDT)
  const knownStablecoins = [
    'Es9vMFrzaCER9JYTZcJJb4sVAXo1ZCUoGFjmDtAyoTyU', // USDT
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'  // USDC
  ];
  return knownStablecoins.includes(inputMint);
}