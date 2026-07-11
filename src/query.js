/**
 * Merges source object fields deeply into target object.
 * @param {Object} target - The target object to merge into.
 * @param {Object} source - The source object containing updates.
 * @returns {Object} The merged target object.
 */
export function deepMerge(target, source) {
    if (!source || typeof source !== 'object') return target;
    if (!target || typeof target !== 'object') target = {};

    for (const key of Object.keys(source)) {
        if (
            source[key] &&
            typeof source[key] === 'object' &&
            !Array.isArray(source[key])
        ) {
            target[key] = deepMerge(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
    return target;
}

/**
 * Checks if a document matches the specified query filter.
 * @param {Object} doc - The document to test.
 * @param {Object} filter - The filter query object.
 * @param {Function} [onFilter] - Optional custom filter override.
 * @param {Function} [normaliseDocument] - Optional document normalization pre-processor.
 * @returns {boolean} True if the document matches the filter, false otherwise.
 */
export function matchesFilter(doc, filter, onFilter = null, normaliseDocument = (d) => d) {
    const normalizedDoc = normaliseDocument(doc);

    if (onFilter) {
        return onFilter(normalizedDoc, filter);
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
