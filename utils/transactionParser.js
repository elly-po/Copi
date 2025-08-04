const { Connection } = require('@solana/web3.js');
const config = require('../config/config.js');

const JUPITER_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

async function parseSwapTransaction(txSignature) {
    try {
        const connection = new Connection(config.solana.rpcUrl);
        const tx = await connection.getParsedTransaction(txSignature, {
            maxSupportedTransactionVersion: 0
        });

        if (!tx?.meta?.innerInstructions) return null;

        // Find Jupiter swap instruction
        const swapInstruction = tx.meta.innerInstructions
            .flatMap(i => i.instructions)
            .find(i => i.programId?.toBase58() === JUPITER_PROGRAM_ID);

        if (!swapInstruction) return null;

        // Extract token mints and amounts
        const { inputMint, outputMint, inAmount, outAmount } = swapInstruction.parsed.info;
        
        return {
            txSignature,
            inputMint,
            outputMint,
            inputAmount: inAmount,
            outputAmount: outAmount,
            isBuy: isBuyOrder(inputMint), // Simple heuristic
            timestamp: tx.blockTime * 1000,
            fee: tx.meta.fee
        };
    } catch (error) {
        console.error('Parse error:', error);
        return null;
    }
}

function isBuyOrder(inputMint) {
    // SOL is WSOL mint address
    return inputMint === 'So11111111111111111111111111111111111111112';
}

module.exports = { parseSwapTransaction };
