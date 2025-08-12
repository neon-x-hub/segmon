import fs from 'fs/promises';
import path from 'path';
import generateId from './id/generate.js';


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
    }) {
        this.basePath = basePath;
        this.segmentSize = segmentSize;
        this.maxItemsPerSegment = maxItemsPerSegment;
        this.idLength = idLength;
        this.normaliseDocument = normaliseDocument;
        this.onFilter = onFilter;
        this.idGenerator = idGenerator;
        this.locks = new Map();
    }

    /* ------------------- PUBLIC API ------------------- */

    /**
     * Creates a new document in the given collection, returning the created document.
     * The document will be assigned a unique ID based on the current segment and the
     * provided data. If the document cannot be created (e.g. due to a segment size
     * limit being exceeded), an error is thrown. If the ID generation fails (e.g.
     * due to a collision), an error is thrown.
     *
     * @param {string} collectionName - The name of the collection to create the document in.
     * @param {object} data - The document data to create.
     * @returns {Promise<object>} The created document.
     */
    async create(collectionName, data) {
        const release = await this._lock(collectionName);
        try {
            const { segment, segmentFile } = await this._getWritableSegment(collectionName);
            const records = await this._readSegment(collectionName, segmentFile);

            // Generate ID with collision check against existing records
            const id = await this._generateId(segment, records);
            const doc = { ...data, id };
            records[id] = doc;

            await this._writeSegment(collectionName, segmentFile, records);
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

        const release = await this._lock(collectionName);
        try {
            const created = [];
            let { segment, segmentFile } = await this._getWritableSegment(collectionName);
            let records = await this._readSegment(collectionName, segmentFile);
            let currentSize = Buffer.byteLength(JSON.stringify(records));
            let currentItemCount = Object.keys(records).length;

            for (const data of docsArray) {
                const id = await this._generateId(segment, records);
                const doc = { ...data, id };
                records[id] = doc;
                created.push(doc);

                currentSize += Buffer.byteLength(JSON.stringify(doc));
                currentItemCount++;

                const sizeLimitReached = currentSize >= this.segmentSize;
                const itemLimitReached = this.maxItemsPerSegment &&
                    currentItemCount >= this.maxItemsPerSegment;

                if (sizeLimitReached || itemLimitReached) {
                    await this._writeSegment(collectionName, segmentFile, records);
                    segment++;
                    segmentFile = `segment_${segment}.json`;
                    records = {};
                    currentSize = 0;
                    currentItemCount = 0;
                }
            }

            if (Object.keys(records).length > 0) {
                await this._writeSegment(collectionName, segmentFile, records);
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
        const segments = await this._listSegments(collectionName);
        const results = [];
        let skipped = 0;

        for (const seg of segments) {
            const records = await this._readSegment(collectionName, seg);
            for (const doc of Object.values(records)) {
                if (!this._matchesFilter(doc, filter)) continue;
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
        const segmentFile = this._segmentFileFromId(id);
        const records = await this._readSegment(collectionName, segmentFile);
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
        const grouped = this._groupIdsBySegment(ids);
        const results = [];

        for (const [segment, idList] of Object.entries(grouped)) {
            const file = `segment_${segment}.json`;
            const records = await this._readSegment(collectionName, file);
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
        const release = await this._lock(collectionName);
        try {
            const segmentFile = this._segmentFileFromId(id);
            const records = await this._readSegment(collectionName, segmentFile);
            if (!records[id]) return null;

            records[id] = this._deepMerge(records[id], updates);
            await this._writeSegment(collectionName, segmentFile, records);
            return records[id];
        } finally {
            release();
        }
    }

    /**
     * Updates multiple documents in the specified collection based on the
     * provided array of update objects. Each object in the array should
     * contain an `id` and a `data` object representing the updates to apply.
     * This function updates documents more efficiently than calling {@link update}
     * multiple times for large arrays, as it writes to disk fewer times.
     *
     * @param {string} collectionName - The name of the collection to update the documents in.
     * @param {object[]} updatesArray - An array of objects, each containing an `id` and `data`.
     * @returns {Promise<object[]>} An array of updated documents.
     */

    async bulkUpdate(collectionName, updatesArray) {
        const release = await this._lock(collectionName);
        try {
            const grouped = {};
            for (const { id, data } of updatesArray) {
                const seg = this._segmentFromId(id);
                if (!grouped[seg]) grouped[seg] = [];
                grouped[seg].push({ id, data });
            }

            const updated = [];
            for (const [seg, items] of Object.entries(grouped)) {
                const file = `segment_${seg}.json`;
                const records = await this._readSegment(collectionName, file);

                for (const { id, data } of items) {
                    if (records[id]) {
                        records[id] = this._deepMerge(records[id], data);
                        updated.push(records[id]);
                    }
                }

                await this._writeSegment(collectionName, file, records);
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
        const release = await this._lock(collectionName);
        try {
            const segmentFile = this._segmentFileFromId(id);
            const records = await this._readSegment(collectionName, segmentFile);
            if (!records[id]) return false;

            delete records[id];
            await this._writeSegment(collectionName, segmentFile, records);
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
        const release = await this._lock(collectionName);
        try {
            const grouped = this._groupIdsBySegment(ids);
            let deletedCount = 0;

            for (const [seg, idList] of Object.entries(grouped)) {
                const file = `segment_${seg}.json`;
                const records = await this._readSegment(collectionName, file);
                let changed = false;
                for (const id of idList) {
                    if (records[id]) {
                        delete records[id];
                        deletedCount++;
                        changed = true;
                    }
                }
                if (changed) await this._writeSegment(collectionName, file, records);
            }
            return deletedCount;
        } finally {
            release();
        }
    }

    /* ------------------- INTERNAL HELPERS ------------------- */

    _deepMerge(target, source) {
        if (!source || typeof source !== 'object') return target;
        if (!target || typeof target !== 'object') target = {};

        for (const key of Object.keys(source)) {
            if (
                source[key] &&
                typeof source[key] === 'object' &&
                !Array.isArray(source[key])
            ) {
                target[key] = this._deepMerge(target[key], source[key]);
            } else {
                target[key] = source[key];
            }
        }
        return target;
    }


    async _getCollectionPath(name) {
        const dir = path.join(this.basePath, name);
        await fs.mkdir(dir, { recursive: true });
        return dir;
    }

    async _listSegments(name) {
        const dir = await this._getCollectionPath(name);
        const files = await fs.readdir(dir);
        return files.filter(f => f.startsWith('segment_') && f.endsWith('.json')).sort();
    }

    async _getWritableSegment(name) {
        const segments = await this._listSegments(name);
        if (segments.length === 0) return { segment: 0, segmentFile: 'segment_0.json' };

        const lastSegment = segments[segments.length - 1];
        const segNum = parseInt(lastSegment.match(/segment_(\d+)\.json/)[1]);
        const filePath = path.join(await this._getCollectionPath(name), lastSegment);
        const stats = await fs.stat(filePath);
        const records = await this._readSegment(name, lastSegment);

        const isSizeExceeded = stats.size >= this.segmentSize;
        const isItemCountExceeded = this.maxItemsPerSegment &&
            Object.keys(records).length >= this.maxItemsPerSegment;

        if (isSizeExceeded || isItemCountExceeded) {
            return { segment: segNum + 1, segmentFile: `segment_${segNum + 1}.json` };
        }
        return { segment: segNum, segmentFile: lastSegment };
    }

    async _readSegment(name, segment) {
        try {
            const file = path.join(await this._getCollectionPath(name), segment);
            const data = await fs.readFile(file, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            if (err.code === 'ENOENT') return {};
            throw err;
        }
    }

    async _writeSegment(name, segment, records) {
        const file = path.join(await this._getCollectionPath(name), segment);
        await fs.writeFile(file, JSON.stringify(records, null, 2));
    }

    async _generateId(segment, existingRecords = null) {
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            const generatedId = await this.idGenerator(this.idLength);
            const id = `${segment}_${generatedId}`;
            if (!existingRecords || !existingRecords[id]) return id;
            attempts++;
        }
        throw new Error(`Failed to generate unique ID after ${maxAttempts} attempts`);
    }

    _segmentFromId(id) {
        return parseInt(id.split('_')[0], 10);
    }

    _segmentFileFromId(id) {
        return `segment_${this._segmentFromId(id)}.json`;
    }

    _groupIdsBySegment(ids) {
        const grouped = {};
        for (const id of ids) {
            const seg = this._segmentFromId(id);
            if (!grouped[seg]) grouped[seg] = [];
            grouped[seg].push(id);
        }
        return grouped;
    }

    _matchesFilter(doc, filter) {
        const normalizedDoc = this.normaliseDocument(doc);

        if (this.onFilter) {
            return this.onFilter(normalizedDoc, filter);
        }

        const matchField = (docField, filterVal) => {
            if (typeof filterVal === 'function') {
                return filterVal(docField);
            }

            if (typeof filterVal === 'object' && filterVal !== null && !Array.isArray(filterVal)) {
                const { min, max } = filterVal;
                if (typeof docField === 'number' || docField instanceof Date) {
                    const value = docField instanceof Date ? docField.getTime() : docField;
                    const minVal = min instanceof Date ? min.getTime() : min;
                    const maxVal = max instanceof Date ? max.getTime() : max;
                    if (min !== undefined && value < minVal) return false;
                    if (max !== undefined && value > maxVal) return false;
                    return true;
                }

                return false;
            }

            if (typeof docField === 'string' && typeof filterVal === 'string') {
                return docField.toLowerCase().includes(filterVal.toLowerCase());
            }

            return docField === filterVal;
        };

        return Object.entries(filter).every(([key, value]) =>
            matchField(normalizedDoc[key], value)
        );
    }



    /* ------------------- SIMPLE MUTEX ------------------- */
    async _lock(name) {
        const existing = this.locks.get(name) || Promise.resolve();
        let release;
        const lock = new Promise(res => (release = res));
        this.locks.set(name, existing.then(() => lock));
        return release;
    }
}

export default Segmon;
