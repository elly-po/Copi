# Copi
CopiAlpha
🚀 Solana Alpha Mimic Bot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![Solana](https://img.shields.io/badge/Solana-1.16%2B-blue)](https://solana.com/)

A high-performance trading bot that automatically mimics trades from expert Solana wallets in real-time, powered by Helius and Jupiter APIs.

get it here
https://t.me/@copiAlpha_bot

## 🔍 Features

- **Real-time Tracking**: Monitors alpha wallets via Helius WebSocket/RPC
- **Smart Execution**: Routes trades through Jupiter Aggregator for best prices
- **Customizable**: 
  - Set trade amounts in SOL
  - Adjust slippage tolerance
  - Toggle buy/sell copying
  - Add delay before execution
- **Secure**: Encrypted wallet storage with military-grade AES-256
- **Telegram UI**: Full control via Telegram bot interface

## ⚙️ Architecture

```mermaid
graph TD
    A[Telegram Bot] --> B[Blockchain Monitor]
    B --> C[Trade Executor]
    C --> D[Jupiter API]
    D --> E[User Wallet]
    B --> F[Database]
