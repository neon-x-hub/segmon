/**
 * Generates a random string of characters of a given length, using the
 * given alphabet of characters. The generated string is suitable for
 * use as a unique identifier.
 *
 * @param {number} length - The length of the string to generate.
 * @returns {string} A random string of the given length.
 */
function generateId(length = 10) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * alphabet.length);
        id += alphabet[randomIndex];
    }
    return id;
}

export default generateId;
