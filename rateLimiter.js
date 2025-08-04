// rateLimiter.js

class RateLimiter {
  constructor() {
    this.counters = new Map();
    setInterval(() => this.resetCounters(), 1000); // Reset every second
  }

  check(resource, limit) {
    const now = Date.now();
    const key = `${resource}_${Math.floor(now / 1000)}`; // Per-second window

    const count = this.counters.get(key) || 0;
    if (count >= limit) {
      const waitMs = 1000 - (now % 1000);
      return new Promise(resolve =>
        setTimeout(() => resolve(this.check(resource, limit)), waitMs)
      );
    }

    this.counters.set(key, count + 1);
    return Promise.resolve(true);
  }

  resetCounters() {
    const currentSecond = Math.floor(Date.now() / 1000);
    for (const [key] of this.counters) {
      const keySecond = parseInt(key.split('_')[1], 10);
      if (keySecond < currentSecond - 1) {
        this.counters.delete(key);
      }
    }
  }
}

const rateLimiter = new RateLimiter();
export default rateLimiter;