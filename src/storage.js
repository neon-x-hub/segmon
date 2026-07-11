import fs from 'fs/promises';
import path from 'path';

/**
 * Manages physical segments, directories, reading/writing files,
 * and segment ID generation/parsing.
 */
export class StorageManager {
    /**
     * Creates a StorageManager instance.
     * @param {Object} config - Configuration options.
     * @param {string} config.basePath - Base directory for database.
     * @param {number} config.segmentSize - Maximum segment size in bytes.
     * @param {number|null} config.maxItemsPerSegment - Maximum items per segment.
     * @param {number} config.idLength - Default ID length.
     * @param {Function} config.idGenerator - Custom ID generator.
     */
    constructor({
        basePath,
        segmentSize,
        maxItemsPerSegment,
        idLength,
        idGenerator
    }) {
        this.basePath = basePath;
        this.segmentSize = segmentSize;
        this.maxItemsPerSegment = maxItemsPerSegment;
        this.idLength = idLength;
        this.idGenerator = idGenerator;
    }

    /**
     * Resolves the full path to a collection directory, creating it if necessary.
     * @param {string} name - Collection name.
     * @returns {Promise<string>} The absolute or relative path to the directory.
     */
    async getCollectionPath(name) {
        const dir = path.join(this.basePath, name);
        await fs.mkdir(dir, { recursive: true });
        return dir;
    }

    /**
     * Lists all sorted segment files inside a collection directory.
     * @param {string} name - Collection name.
     * @returns {Promise<string[]>} List of segment file names.
     */
    async listSegments(name) {
        const dir = await this.getCollectionPath(name);
        try {
            const files = await fs.readdir(dir);
            return files.filter(f => f.startsWith('segment_') && f.endsWith('.json')).sort();
        } catch (err) {
            if (err.code === 'ENOENT') return [];
            throw err;
        }
    }

    /**
     * Reads a segment file's records.
     * @param {string} name - Collection name.
     * @param {string} segmentFile - Segment filename.
     * @returns {Promise<Object>} The parsed records.
     */
    async readSegment(name, segmentFile) {
        try {
            const dir = await this.getCollectionPath(name);
            const file = path.join(dir, segmentFile);
            const data = await fs.readFile(file, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            if (err.code === 'ENOENT') return {};
            throw err;
        }
    }

    /**
     * Writes records to a segment file.
     * @param {string} name - Collection name.
     * @param {string} segmentFile - Segment filename.
     * @param {Object} records - Records to serialize.
     * @returns {Promise<void>}
     */
    async writeSegment(name, segmentFile, records) {
        const dir = await this.getCollectionPath(name);
        const file = path.join(dir, segmentFile);
        await fs.writeFile(file, JSON.stringify(records, null, 2));
    }

    /**
     * Determines which segment file to write the next document to, based on sizing limits.
     * @param {string} name - Collection name.
     * @returns {Promise<{segment: number, segmentFile: string}>} Details of the writable segment.
     */
    async getWritableSegment(name) {
        const segments = await this.listSegments(name);
        if (segments.length === 0) return { segment: 0, segmentFile: 'segment_0.json' };

        const lastSegment = segments[segments.length - 1];
        const segNum = parseInt(lastSegment.match(/segment_(\d+)\.json/)[1], 10);
        const dir = await this.getCollectionPath(name);
        const filePath = path.join(dir, lastSegment);

        let stats;
        try {
            stats = await fs.stat(filePath);
        } catch (err) {
            if (err.code === 'ENOENT') {
                return { segment: segNum, segmentFile: lastSegment };
            }
            throw err;
        }

        const records = await this.readSegment(name, lastSegment);

        const isSizeExceeded = stats.size >= this.segmentSize;
        const isItemCountExceeded = this.maxItemsPerSegment &&
            Object.keys(records).length >= this.maxItemsPerSegment;

        if (isSizeExceeded || isItemCountExceeded) {
            return { segment: segNum + 1, segmentFile: `segment_${segNum + 1}.json` };
        }
        return { segment: segNum, segmentFile: lastSegment };
    }

    /**
     * Generates a unique document ID, checking for collision in existing segment records.
     * @param {number} segment - Segment index.
     * @param {Object} [existingRecords] - Existing records in the segment.
     * @returns {Promise<string>} Unique generated ID.
     */
    async generateId(segment, existingRecords = null) {
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

    /**
     * Extracts segment index from a document ID.
     * @param {string} id - Document ID.
     * @returns {number} Segment index.
     */
    segmentFromId(id) {
        return parseInt(id.split('_')[0], 10);
    }

    /**
     * Gets segment filename from a document ID.
     * @param {string} id - Document ID.
     * @returns {string} Segment filename.
     */
    segmentFileFromId(id) {
        return `segment_${this.segmentFromId(id)}.json`;
    }

    /**
     * Groups a list of document IDs by their segment indices.
     * @param {string[]} ids - List of document IDs.
     * @returns {Object<string, string[]>} Mapping of segment index to list of IDs.
     */
    groupIdsBySegment(ids) {
        const grouped = {};
        for (const id of ids) {
            const seg = this.segmentFromId(id);
            if (!grouped[seg]) grouped[seg] = [];
            grouped[seg].push(id);
        }
        return grouped;
    }
}
