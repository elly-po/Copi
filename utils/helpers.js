/**
 * Async sleep/delay function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxAttempts - Maximum retry attempts
 * @param {number} baseDelay - Base delay in ms (exponential)
 * @returns {Promise<any>}
 */
async function retryWithBackoff(fn, maxAttempts = 3, baseDelay = 1000) {
    let attempt = 1;
    while (true) {
        try {
            return await fn();
        } catch (error) {
            if (attempt >= maxAttempts) throw error;
            const delay = baseDelay * 2 ** (attempt - 1);
            await sleep(delay);
            attempt++;
        }
    }
}

module.exports = {
    sleep,
    retryWithBackoff
};