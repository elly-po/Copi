// security/auth.js
const crypto = require('crypto');
const config = require('../config/config');

// AES-256-CBC Encryption
function encryptPrivateKey(privateKey, encryptionKey = null) {
    try {
        const key = encryptionKey || config.get().security.encryptionKey;
        const iv = crypto.randomBytes(16); // Generate random IV
        const cipher = crypto.createCipheriv('aes-256-cbc', 
            Buffer.from(key, 'utf8'), 
            iv
        );
        
        let encrypted = cipher.update(privateKey, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return `${iv.toString('hex')}:${encrypted}`; // IV:EncryptedData
    } catch (error) {
        console.error('Encryption failed:', error);
        throw new Error('Private key encryption failed');
    }
}

// AES-256-CBC Decryption
function decryptPrivateKey(encryptedData, encryptionKey = null) {
    try {
        const key = encryptionKey || config.get().security.encryptionKey;
        const parts = encryptedData.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedText = parts[1];
        
        const decipher = crypto.createDecipheriv('aes-256-cbc',
            Buffer.from(key, 'utf8'),
            iv
        );
        
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        console.error('Decryption failed:', error);
        throw new Error('Private key decryption failed - possibly wrong key');
    }
}

// Key Validation Utility
function validateEncryptionKey(key) {
    if (!key || key.length !== 32) {
        throw new Error('Encryption key must be 32 characters long');
    }
}

module.exports = {
    encryptPrivateKey,
    decryptPrivateKey,
    validateEncryptionKey
};