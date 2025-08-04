const axios = require('axios');
const { 
    Connection, 
    PublicKey, 
    Transaction, 
    VersionedTransaction,
    LAMPORTS_PER_SOL 
} = require('@solana/web3.js');
const config = require('../config/config');
const walletManager = require('../wallet/walletManager');

class JupiterTrader {
    constructor() {
        this.connection = null;
        this.jupiterApiUrl = null;
        this.initializeTrader();
    }

    async initializeTrader() {
        try {
            const configData = await config.get();
            this.connection = walletManager.connection;
            this.jupiterApiUrl = configData.jupiter.apiUrl;
            
            console.log('✅ Jupiter trader initialized');
        } catch (error) {
            console.error('❌ Failed to initialize Jupiter trader:', error);
            throw error;
        }
    }

    // Get quote for a swap
    async getQuote(inputMint, outputMint, amount, slippageBps = 300) {
        try {
            const params = new URLSearchParams({
                inputMint,
                outputMint,
                amount: amount.toString(),
                slippageBps: slippageBps.toString(),
                onlyDirectRoutes: 'false',
                asLegacyTransaction: 'false'
            });

            const response = await axios.get(`${this.jupiterApiUrl}/quote?${params}`);
            
            if (!response.data) {
                throw new Error('No quote received from Jupiter');
            }

            return response.data;
        } catch (error) {
            console.error('Error getting Jupiter quote:', error);
            throw new Error(`Failed to get quote: ${error.message}`);
        }
    }

    // Get swap transaction
    async getSwapTransaction(quote, userPublicKey, priorityFee = 0) {
        try {
            const swapRequest = {
                quoteResponse: quote,
                userPublicKey,
                wrapAndUnwrapSol: true,
                useSharedAccounts: true,
                feeAccount: null,
                trackingAccount: null,
                computeUnitPriceMicroLamports: priorityFee
            };

            const response = await axios.post(
                `${this.jupiterApiUrl.replace('/quote', '')}/swap`,
                swapRequest,
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!response.data) {
                throw new Error('No swap transaction received from Jupiter');
            }

            return response.data;
        } catch (error) {
            console.error('Error getting swap transaction:', error);
            throw new Error(`Failed to get swap transaction: ${error.message}`);
        }
    }

    // Execute swap
    async executeSwap(inputMint, outputMint, amount, userKeypair, slippageBps = 300, priorityFee = 0) {
        try {
            console.log(`🔄 Executing swap: ${amount} ${inputMint} -> ${outputMint}`);
            
            // Get quote
            const quote = await this.getQuote(inputMint, outputMint, amount, slippageBps);
            
            console.log(`📊 Quote received: ${quote.inAmount} -> ${quote.outAmount}`);
            console.log(`💰 Price impact: ${quote.priceImpactPct}%`);
            
            // Get swap transaction
            const swapTransaction = await this.getSwapTransaction(
                quote,
                userKeypair.publicKey.toString(),
                priorityFee
            );
            
            // Deserialize and sign transaction
            const transactionBuf = Buffer.from(swapTransaction.swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(transactionBuf);
            
            // Sign the transaction
            transaction.sign([userKeypair]);
            
            // Send and confirm transaction
            const signature = await this.connection.sendRawTransaction(
                transaction.serialize(),
                {
                    skipPreflight: false,
                    preflightCommitment: 'processed',
                    maxRetries: 3
                }
            );
            
            console.log(`📤 Transaction sent: ${signature}`);
            
            // Wait for confirmation
            const confirmation = await this.connection.confirmTransaction(
                signature,
                'confirmed'
            );
            
            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }
            
            console.log(`✅ Swap completed: ${signature}`);
            
            return {
                signature,
                inputMint,
                outputMint,
                inputAmount: quote.inAmount,
                outputAmount: quote.outAmount,
                priceImpact: quote.priceImpactPct,
                fee: quote.otherAmountThreshold,
                success: true
            };
            
        } catch (error) {
            console.error('❌ Swap execution failed:', error);
            return {
                signature: null,
                inputMint,
                outputMint,
                inputAmount: amount,
                outputAmount: 0,
                priceImpact: 0,
                fee: 0,
                success: false,
                error: error.message
            };
        }
    }

    // Buy token with SOL
    async buyToken(tokenMint, solAmount, userKeypair, slippageBps = 300) {
        const solMint = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
        const amountInLamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
        
        return await this.executeSwap(
            solMint,
            tokenMint,
            amountInLamports,
            userKeypair,
            slippageBps
        );
    }

    // Sell token for SOL
    async sellToken(tokenMint, tokenAmount, userKeypair, slippageBps = 300) {
        const solMint = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
        
        return await this.executeSwap(
            tokenMint,
            solMint,
            tokenAmount,
            userKeypair,
            slippageBps
        );
    }

    // Get token price in SOL
    async getTokenPrice(tokenMint, amount = 1000000) { // 1 token with 6 decimals
        try {
            const solMint = 'So11111111111111111111111111111111111111112';
            const quote = await this.getQuote(tokenMint, solMint, amount);
            
            const tokenDecimals = 6; // Assume 6 decimals, should be fetched from mint
            const solDecimals = 9;
            
            const tokenAmountActual = amount / Math.pow(10, tokenDecimals);
            const solAmountActual = parseInt(quote.outAmount) / Math.pow(10, solDecimals);
            
            return {
                tokenMint,
                priceInSOL: solAmountActual / tokenAmountActual,
                amount: tokenAmountActual,
                solValue: solAmountActual
            };
        } catch (error) {
            console.error('Error getting token price:', error);
            return null;
        }
    }

    // Get supported tokens
    async getSupportedTokens() {
        try {
            const response = await axios.get('https://token.jup.ag/strict');
            return response.data;
        } catch (error) {
            console.error('Error getting supported tokens:', error);
            return [];
        }
    }

    // Check if token is supported
    async isTokenSupported(tokenMint) {
        try {
            const solMint = 'So11111111111111111111111111111111111111112';
            await this.getQuote(solMint, tokenMint, 1000000); // Try to get a quote
            return true;
        } catch (error) {
            return false;
        }
    }

    // Calculate optimal slippage based on market conditions
    calculateOptimalSlippage(priceImpact, volatility = 1) {
        // Base slippage
        let slippage = 300; // 3%
        
        // Increase slippage for high price impact trades
        if (priceImpact > 2) {
            slippage += 200; // Add 2%
        }
        
        // Increase slippage for volatile tokens
        if (volatility > 2) {
            slippage += 100; // Add 1%
        }
        
        // Cap at 10%
        return Math.min(slippage, 1000);
    }

    // Estimate gas fees
    async estimateGasFees() {
        try {
            const recentBlockhash = await this.connection.getLatestBlockhash();
            const feeCalculator = await this.connection.getFeeCalculatorForBlockhash(
                recentBlockhash.blockhash
            );
            
            return {
                baseFee: feeCalculator?.value?.lamportsPerSignature || 5000,
                priorityFee: 10000, // Recommended priority fee
                totalEstimate: 15000
            };
        } catch (error) {
            console.error('Error estimating gas fees:', error);
            return {
                baseFee: 5000,
                priorityFee: 10000,
                totalEstimate: 15000
            };
        }
    }

    // Validate swap parameters
    validateSwapParams(inputMint, outputMint, amount, slippageBps) {
        if (!inputMint || !outputMint) {
            throw new Error('Input and output mints are required');
        }
        
        if (inputMint === outputMint) {
            throw new Error('Input and output mints cannot be the same');
        }
        
        if (!amount || amount <= 0) {
            throw new Error('Amount must be greater than 0');
        }
        
        if (slippageBps < 0 || slippageBps > 5000) { // 0-50%
            throw new Error('Slippage must be between 0 and 5000 basis points');
        }
        
        try {
            new PublicKey(inputMint);
            new PublicKey(outputMint);
        } catch (error) {
            throw new Error('Invalid mint address format');
        }
        
        return true;
    }

    // Get route information
    async getRouteInfo(inputMint, outputMint, amount) {
        try {
            const quote = await this.getQuote(inputMint, outputMint, amount);
            
            return {
                inputMint,
                outputMint,
                inputAmount: quote.inAmount,
                outputAmount: quote.outAmount,
                priceImpact: quote.priceImpactPct,
                marketInfos: quote.marketInfos || [],
                routePlan: quote.routePlan || [],
                otherAmountThreshold: quote.otherAmountThreshold,
                swapMode: quote.swapMode,
                slippageBps: quote.slippageBps
            };
        } catch (error) {
            console.error('Error getting route info:', error);
            return null;
        }
    }

    // Health check
    async isHealthy() {
        try {
            const response = await axios.get(`${this.jupiterApiUrl}/health`);
            return response.status === 200;
        } catch (error) {
            console.error('Jupiter health check failed:', error);
            return false;
        }
    }
}

module.exports = new JupiterTrader();