import generateId from './id/generate.js';
import { MutexManager } from './mutex.js';
import { StorageManager } from './storage.js';
import { matchesFilter, deepMerge } from './query.js';

/**
 * A segmented JSON database provider with customizable ID generation, filtering, and dual segmentation limits.
 * @class
 */
class Segmon {
    /**
     * Creates a new Segmon instance.
     * @constructor
     * @param {Object} config - Configuration options
     * @param {string} [config.basePath='./segmon-data'] - Base directory for storing collections
     * @param {number} [config.segmentSize=51200] - Maximum segment file size in bytes (default: 50KB)
     * @param {number|null} [config.maxItemsPerSegment=null] - Maximum documents per segment (optional)
     * @param {Function} [config.onFilter=null] - Custom filter function to override default matching logic
     * @param {number} [config.idLength=6] - Length of generated IDs (when using default generator)
     * @param {Function} [config.idGenerator=generateId] - Custom ID generator function
     * @param {Function} [config.normaliseDocument=(doc) => doc] - Document normalization function before filtering
     * @example
     * const db = new Segmon({
     *   basePath: './data',
     *   segmentSize: 100000, // 100KB segments
     *   idGenerator: customIdFn
     * });
     */
    constructor({
        basePath = './segmon-data',
        segmentSize = 50 * 1024,
        maxItemsPerSegment = null,
        onFilter = null,
        idLength = 6,
        idGenerator = generateId,
        normaliseDocument = (doc) => doc
    } = {}) {
        this.basePath = basePath;
        this.segmentSize = segmentSize;
        this.maxItemsPerSegment = maxItemsPerSegment;
        this.idLength = idLength;
        this.normaliseDocument = normaliseDocument;
        this.onFilter = onFilter;
        this.idGenerator = idGenerator;

        // Initialize helper managers
        this.mutex = new MutexManager();
        this.locks = this.mutex.locks; // Keep reference to the lock Map for backward compatibility

        this.storage = new StorageManager({
            basePath: this.basePath,
            segmentSize: this.segmentSize,
            maxItemsPerSegment: this.maxItemsPerSegment,
            idLength: this.idLength,
            idGenerator: this.idGenerator
        });
    }

    /* ------------------- PUBLIC API ------------------- */

    /**
     * Creates a new document in the given collection, returning the created document.
     * The document will be assigned a unique ID based on the current segment and the
     * provided data.
     *
     * @param {string} collectionName - The name of the collection to create the document in.
     * @param {object} data - The document data to create.
     * @returns {Promise<object>} The created document.
     */
    async create(collectionName, data) {
        const release = await this.mutex.lock(collectionName);
        try {
            const { segment, segmentFile } = await this.storage.getWritableSegment(collectionName);
            const records = await this.storage.readSegment(collectionName, segmentFile);

            // Generate ID with collision check against existing records
            const id = await this.storage.generateId(segment, records);
            const doc = { ...data, id };
            records[id] = doc;

            await this.storage.writeSegment(collectionName, segmentFile, records);
            return doc;
        } catch (err) {
            // Handle ID generation failures
            if (err.message.includes('Failed to generate unique ID')) {
                throw new Error(`Cannot create document in ${collectionName}: ${err.message}`);
            }
            throw err;
        } finally {
            release();
        }
    }

    /**
     * Creates multiple documents in the given collection, returning the created documents.
     * This function performs more efficiently than calling {@link create} multiple times for
     * large arrays of documents, as it writes to disk fewer times.
     *
     * @param {string} collectionName - The name of the collection to create the documents in.
     * @param {object[]} docsArray - The array of document data to create.
     * @returns {Promise<object[]>} The created documents.
     */
    async bulkCreate(collectionName, docsArray) {
        if (!Array.isArray(docsArray)) return [];

        const release = await this.mutex.lock(collectionName);
        try {
            const created = [];
            let { segment, segmentFile } = await this.storage.getWritableSegment(collectionName);
            let records = await this.storage.readSegment(collectionName, segmentFile);
            let currentSize = Buffer.byteLength(JSON.stringify(records));
            let currentItemCount = Object.keys(records).length;

            for (const data of docsArray) {
                const id = await this.storage.generateId(segment, records);
                const doc = { ...data, id };
                records[id] = doc;
                created.push(doc);

                currentSize += Buffer.byteLength(JSON.stringify(doc));
                currentItemCount++;

                const sizeLimitReached = currentSize >= this.segmentSize;
                const itemLimitReached = this.maxItemsPerSegment &&
                    currentItemCount >= this.maxItemsPerSegment;

                if (sizeLimitReached || itemLimitReached) {
                    await this.storage.writeSegment(collectionName, segmentFile, records);
                    segment++;
                    segmentFile = `segment_${segment}.json`;
                    records = {};
                    currentSize = 0;
                    currentItemCount = 0;
                }
            }

            if (Object.keys(records).length > 0) {
                await this.storage.writeSegment(collectionName, segmentFile, records);
            }

            return created;
        } catch (err) {
            if (err.message.includes('Failed to generate unique ID')) {
                throw new Error(`Bulk create failed in ${collectionName}: ${err.message}`);
            }
            throw err;
        } finally {
            release();
        }
    }

    /**
     * Finds documents in the collection that match the given filter object.
     * Supports pagination through the `limit` and `offset` options.
     *
     * @param {string} collectionName - The name of the collection to query.
     * @param {object} filter - The filter object to apply. Filter properties
     * will be matched against document properties of the same name.
     * @param {{ limit: number, offset: number }} [options] - Optional pagination
     * options. `limit` specifies the maximum number of documents to return, and
     * `offset` specifies the number of documents to skip before returning results.
     * @returns {Promise<object[]>} An array of matching documents.
     */
    async find(collectionName, filter = {}, { limit = Infinity, offset = 0 } = {}) {
        const segments = await this.storage.listSegments(collectionName);
        const results = [];
        let skipped = 0;

        for (const seg of segments) {
            const records = await this.storage.readSegment(collectionName, seg);
            for (const doc of Object.values(records)) {
                if (!matchesFilter(doc, filter, this.onFilter, this.normaliseDocument)) continue;
                if (skipped < offset) { skipped++; continue; }
                results.push(doc);
                if (results.length >= limit) return results;
            }
        }
        return results;
    }

    /**
     * Finds a document in the collection by its ID.
     *
     * @param {string} collectionName - The name of the collection to query.
     * @param {string} id - The ID of the document to find.
     * @returns {Promise<object|null>} The document with the given ID, or null if
     * not found.
     */
    async findById(collectionName, id) {
        const segmentFile = this.storage.segmentFileFromId(id);
        const records = await this.storage.readSegment(collectionName, segmentFile);
        return records[id] || null;
    }

    /**
     * Finds multiple documents in the collection by their IDs.
     *
     * @param {string} collectionName - The name of the collection to query.
     * @param {string[]} ids - The IDs of the documents to find.
     * @returns {Promise<object[]>} An array of documents with the given IDs, in
     * the same order as the IDs provided.
     */
    async bulkFindByIds(collectionName, ids) {
        const grouped = this.storage.groupIdsBySegment(ids);
        const results = [];

        for (const [segment, idList] of Object.entries(grouped)) {
            const file = `segment_${segment}.json`;
            const records = await this.storage.readSegment(collectionName, file);
            for (const id of idList) {
                if (records[id]) results.push(records[id]);
            }
        }
        return results;
    }

    /**
     * Updates a document in the collection by its ID.
     *
     * @param {string} collectionName - The name of the collection to update.
     * @param {string} id - The ID of the document to update.
     * @param {object} updates - The updates to apply to the document.
     * @returns {Promise<object|null>} The updated document, or null if not found.
     */
    async update(collectionName, id, updates) {
        const release = await this.mutex.lock(collectionName);
        try {
            const segmentFile = this.storage.segmentFileFromId(id);
            const records = await this.storage.readSegment(collectionName, segmentFile);
            if (!records[id]) return null;

            records[id] = deepMerge(records[id], updates);
            await this.storage.writeSegment(collectionName, segmentFile, records);
            return records[id];
        } finally {
            release();
        }
    }

    /**
     * Updates multiple documents in the specified collection based on the
     * provided array of update objects. Each object in the array should
     * contain an `id` and a `data` object representing the updates to apply.
     *
     * @param {string} collectionName - The name of the collection to update the documents in.
     * @param {object[]} updatesArray - An array of objects, each containing an `id` and `data`.
     * @returns {Promise<object[]>} An array of updated documents.
     */
    async bulkUpdate(collectionName, updatesArray) {
        const release = await this.mutex.lock(collectionName);
        try {
            const grouped = {};
            for (const { id, data } of updatesArray) {
                const seg = this.storage.segmentFromId(id);
                if (!grouped[seg]) grouped[seg] = [];
                grouped[seg].push({ id, data });
            }

            const updated = [];
            for (const [seg, items] of Object.entries(grouped)) {
                const file = `segment_${seg}.json`;
                const records = await this.storage.readSegment(collectionName, file);

                for (const { id, data } of items) {
                    if (records[id]) {
                        records[id] = deepMerge(records[id], data);
                        updated.push(records[id]);
                    }
                }

                await this.storage.writeSegment(collectionName, file, records);
            }
            return updated;
        } finally {
            release();
        }
    }

    /**
     * Deletes a document from the collection by its ID.
     *
     * @param {string} collectionName - The name of the collection to delete from.
     * @param {string} id - The ID of the document to delete.
     * @returns {Promise<boolean>} A boolean indicating whether the document was
     * deleted. If the document was not found, the function returns false.
     */
    async delete(collectionName, id) {
        const release = await this.mutex.lock(collectionName);
        try {
            const segmentFile = this.storage.segmentFileFromId(id);
            const records = await this.storage.readSegment(collectionName, segmentFile);
            if (!records[id]) return false;

            delete records[id];
            await this.storage.writeSegment(collectionName, segmentFile, records);
            return true;
        } finally {
            release();
        }
    }

    /**
     * Deletes multiple documents from the collection by their IDs.
     *
     * @param {string} collectionName - The name of the collection to delete from.
     * @param {string[]} ids - The IDs of the documents to delete.
     * @returns {Promise<number>} The number of documents deleted.
     */
    async bulkDelete(collectionName, ids) {
        const release = await this.mutex.lock(collectionName);
        try {
            const grouped = this.storage.groupIdsBySegment(ids);
            let deletedCount = 0;

            for (const [seg, idList] of Object.entries(grouped)) {
                const file = `segment_${seg}.json`;
                const records = await this.storage.readSegment(collectionName, file);
                let changed = false;
                for (const id of idList) {
                    if (records[id]) {
                        delete records[id];
                        deletedCount++;
                        changed = true;
                    }
                }
                if (changed) await this.storage.writeSegment(collectionName, file, records);
            }
            return deletedCount;
        } finally {
            release();
        }
    }

    /* ------------------- DELEGATION ALIASES (BACKWARD COMPATIBILITY) ------------------- */

    _deepMerge(target, source) {
        return deepMerge(target, source);
    }

    async _getCollectionPath(name) {
        return this.storage.getCollectionPath(name);
    }

    async _listSegments(name) {
        return this.storage.listSegments(name);
    }

    async _getWritableSegment(name) {
        return this.storage.getWritableSegment(name);
    }

    async _readSegment(name, segment) {
        return this.storage.readSegment(name, segment);
    }

    async _writeSegment(name, segment, records) {
        return this.storage.writeSegment(name, segment, records);
    }

    async _generateId(segment, existingRecords = null) {
        return this.storage.generateId(segment, existingRecords);
    }

    _segmentFromId(id) {
        return this.storage.segmentFromId(id);
    }

    _segmentFileFromId(id) {
        return this.storage.segmentFileFromId(id);
    }

    _groupIdsBySegment(ids) {
        return this.storage.groupIdsBySegment(ids);
    }

    _matchesFilter(doc, filter) {
        return matchesFilter(doc, filter, this.onFilter, this.normaliseDocument);
    }

    async _lock(name) {
        return this.mutex.lock(name);
    }
}

export default Segmon;
