/**
 * Simple Mutex manager for collection-level locking.
 */
export class MutexManager {
    constructor() {
        this.locks = new Map();
    }

    /**
     * Locks a named collection, returning a release function once the lock is acquired.
     * @param {string} name - The collection name.
     * @returns {Promise<Function>} A release function.
     */
    async lock(name) {
        const existing = this.locks.get(name) || Promise.resolve();
        let release;
        const lock = new Promise(res => (release = res));
        this.locks.set(name, existing.then(() => lock));
        await existing; // Wait for the previous lock in the chain to release
        return release;
    }
}
