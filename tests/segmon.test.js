import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs/promises';
import Segmon from '../src/provider.js';

const TEST_DB_PATH = path.join(process.cwd(), 'test-db-data');

// Helper to clean up the test database directory
async function cleanupDB() {
    await fs.rm(TEST_DB_PATH, { recursive: true, force: true });
}

test.before(cleanupDB);
test.after(cleanupDB);

test('Segmon - Basic CRUD Operations', async (t) => {
    const db = new Segmon({ basePath: TEST_DB_PATH });
    const colName = 'users';

    // 1. Create a document
    const doc1 = await db.create(colName, { name: 'Alice', age: 30, active: true });
    assert.ok(doc1.id);
    assert.strictEqual(doc1.name, 'Alice');
    assert.strictEqual(doc1.age, 30);
    assert.strictEqual(doc1.active, true);

    // ID format should be "segmentNumber_randomString"
    assert.match(doc1.id, /^0_[A-Za-z0-9]+$/);

    // 2. Find by ID
    const found1 = await db.findById(colName, doc1.id);
    assert.deepStrictEqual(found1, doc1);

    // 3. Update the document
    const updated1 = await db.update(colName, doc1.id, { age: 31, location: 'Wonderland' });
    assert.ok(updated1);
    assert.strictEqual(updated1.id, doc1.id);
    assert.strictEqual(updated1.age, 31);
    assert.strictEqual(updated1.location, 'Wonderland');
    assert.strictEqual(updated1.name, 'Alice'); // Unchanged properties preserved

    // Verify change is persisted
    const foundUpdated = await db.findById(colName, doc1.id);
    assert.deepStrictEqual(foundUpdated, updated1);

    // 4. Delete the document
    const deleted = await db.delete(colName, doc1.id);
    assert.strictEqual(deleted, true);

    const foundDeleted = await db.findById(colName, doc1.id);
    assert.strictEqual(foundDeleted, null);

    // Delete again should return false
    const deletedAgain = await db.delete(colName, doc1.id);
    assert.strictEqual(deletedAgain, false);
});

test('Segmon - Bulk Operations', async (t) => {
    const db = new Segmon({ basePath: TEST_DB_PATH });
    const colName = 'items';

    const payloads = [
        { title: 'Item A', qty: 10 },
        { title: 'Item B', qty: 20 },
        { title: 'Item C', qty: 30 }
    ];

    // 1. Bulk Create
    const created = await db.bulkCreate(colName, payloads);
    assert.strictEqual(created.length, 3);
    assert.ok(created[0].id);
    assert.ok(created[1].id);
    assert.ok(created[2].id);

    const ids = created.map(d => d.id);

    // 2. Bulk Find
    const found = await db.bulkFindByIds(colName, ids);
    assert.strictEqual(found.length, 3);
    assert.deepStrictEqual(found, created);

    // 3. Bulk Update
    const updates = [
        { id: ids[0], data: { qty: 12, note: 'updated' } },
        { id: ids[1], data: { qty: 22 } }
    ];
    const updatedDocs = await db.bulkUpdate(colName, updates);
    assert.strictEqual(updatedDocs.length, 2);

    const check1 = await db.findById(colName, ids[0]);
    assert.strictEqual(check1.qty, 12);
    assert.strictEqual(check1.note, 'updated');

    const check2 = await db.findById(colName, ids[1]);
    assert.strictEqual(check2.qty, 22);

    // 4. Bulk Delete
    const deletedCount = await db.bulkDelete(colName, [ids[0], ids[2]]);
    assert.strictEqual(deletedCount, 2);

    const remaining = await db.find(colName, {});
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].id, ids[1]);
});

test('Segmon - Filtering & Queries', async (t) => {
    const db = new Segmon({
        basePath: TEST_DB_PATH,
        normaliseDocument: (doc) => {
            if (doc.joined) {
                return { ...doc, joined: new Date(doc.joined) };
            }
            return doc;
        }
    });
    const colName = 'query-users';

    const users = [
        { name: 'Alice Smith', age: 25, role: 'admin', joined: new Date('2025-01-01') },
        { name: 'Bob Jones', age: 34, role: 'user', joined: new Date('2025-02-01') },
        { name: 'Charlie Smith', age: 17, role: 'user', joined: new Date('2025-03-01') },
        { name: 'Diana Prince', age: 29, role: 'admin', joined: new Date('2025-04-01') }
    ];

    await db.bulkCreate(colName, users);

    // Case-insensitive string matching
    const smiths = await db.find(colName, { name: 'smith' });
    assert.strictEqual(smiths.length, 2);
    assert.ok(smiths.every(u => u.name.includes('Smith')));

    // Exact value matching
    const admins = await db.find(colName, { role: 'admin' });
    assert.strictEqual(admins.length, 2);

    // Range matching (numbers)
    const range1 = await db.find(colName, { age: { min: 18, max: 30 } });
    assert.strictEqual(range1.length, 2); // Alice (25), Diana (29)

    const range2 = await db.find(colName, { age: { min: 30 } });
    assert.strictEqual(range2.length, 1); // Bob (34)

    // Range matching (Dates)
    const dateRange = await db.find(colName, {
        joined: {
            min: new Date('2025-01-15'),
            max: new Date('2025-03-15')
        }
    });
    assert.strictEqual(dateRange.length, 2); // Bob (Feb 1), Charlie (Mar 1)

    // Functional filter value
    const funcFilter = await db.find(colName, {
        age: (age) => age % 2 !== 0
    });
    assert.strictEqual(funcFilter.length, 3); // 25, 17, 29 (Alice, Charlie, Diana)

    // Custom normaliseDocument preprocessor
    const normDb = new Segmon({
        basePath: TEST_DB_PATH,
        normaliseDocument: (doc) => {
            return { ...doc, name: doc.name.toUpperCase() };
        }
    });
    const normResults = await normDb.find(colName, { name: 'ALICE SMITH' });
    assert.strictEqual(normResults.length, 1);

    // Custom onFilter override
    const filterDb = new Segmon({
        basePath: TEST_DB_PATH,
        onFilter: (doc, filter) => doc.role === filter.myRoleCustom
    });
    const customResults = await filterDb.find(colName, { myRoleCustom: 'admin' });
    assert.strictEqual(customResults.length, 2);
});

test('Segmon - Pagination (limit & offset)', async (t) => {
    const db = new Segmon({ basePath: TEST_DB_PATH });
    const colName = 'paginated';

    const items = Array.from({ length: 10 }, (_, i) => ({ index: i }));
    await db.bulkCreate(colName, items);

    // Limit only
    const resLimit = await db.find(colName, {}, { limit: 3 });
    assert.strictEqual(resLimit.length, 3);
    assert.strictEqual(resLimit[0].index, 0);
    assert.strictEqual(resLimit[1].index, 1);
    assert.strictEqual(resLimit[2].index, 2);

    // Offset and Limit
    const resOffset = await db.find(colName, {}, { limit: 3, offset: 4 });
    assert.strictEqual(resOffset.length, 3);
    assert.strictEqual(resOffset[0].index, 4);
    assert.strictEqual(resOffset[1].index, 5);
    assert.strictEqual(resOffset[2].index, 6);

    // Overflow limit
    const resOverflow = await db.find(colName, {}, { limit: 20, offset: 8 });
    assert.strictEqual(resOverflow.length, 2);
    assert.strictEqual(resOverflow[0].index, 8);
    assert.strictEqual(resOverflow[1].index, 9);
});

test('Segmon - Dual Segmentation Limits', async (t) => {
    // 1. Limit by max items per segment (e.g. maxItemsPerSegment = 2)
    const dbItemLimit = new Segmon({
        basePath: TEST_DB_PATH,
        maxItemsPerSegment: 2
    });
    const colName1 = 'segment-items-limit';

    const docA = await dbItemLimit.create(colName1, { key: 'a' });
    const docB = await dbItemLimit.create(colName1, { key: 'b' });
    const docC = await dbItemLimit.create(colName1, { key: 'c' });

    assert.strictEqual(docA.id.startsWith('0_'), true);
    assert.strictEqual(docB.id.startsWith('0_'), true);
    assert.strictEqual(docC.id.startsWith('1_'), true); // Should split to segment 1

    const files1 = await fs.readdir(path.join(TEST_DB_PATH, colName1));
    assert.ok(files1.includes('segment_0.json'));
    assert.ok(files1.includes('segment_1.json'));

    // 2. Limit by segment size (e.g. segmentSize = 150 bytes)
    const dbSizeLimit = new Segmon({
        basePath: TEST_DB_PATH,
        segmentSize: 150
    });
    const colName2 = 'segment-size-limit';

    // We write a large payload
    const docX = await dbSizeLimit.create(colName2, { data: 'x'.repeat(100) });
    // The second write should go to a new segment because segment_0 size is already around 150+ bytes
    const docY = await dbSizeLimit.create(colName2, { data: 'y'.repeat(100) });

    assert.strictEqual(docX.id.startsWith('0_'), true);
    assert.strictEqual(docY.id.startsWith('1_'), true);

    const files2 = await fs.readdir(path.join(TEST_DB_PATH, colName2));
    assert.ok(files2.includes('segment_0.json'));
    assert.ok(files2.includes('segment_1.json'));
});

test('Segmon - Mutex Locks & Concurrency', async (t) => {
    const db = new Segmon({ basePath: TEST_DB_PATH });
    const colName = 'concurrency';

    // We run multiple writes in parallel. Since Segmon uses a Mutex,
    // they should be processed sequentially and not corrupt the segment file.
    const promises = Array.from({ length: 20 }, (_, i) => {
        return db.create(colName, { value: i });
    });

    const results = await Promise.all(promises);
    assert.strictEqual(results.length, 20);

    const docs = await db.find(colName, {});
    assert.strictEqual(docs.length, 20);

    // Verify every value is present
    const values = docs.map(d => d.value).sort((a, b) => a - b);
    const expected = Array.from({ length: 20 }, (_, i) => i);
    assert.deepStrictEqual(values, expected);
});

test('Segmon - Custom ID Generation & Length', async (t) => {
    const customGenerator = (length) => `custom_${length}_xyz`;
    const db = new Segmon({
        basePath: TEST_DB_PATH,
        idLength: 12,
        idGenerator: customGenerator
    });
    const colName = 'custom-ids';

    const doc = await db.create(colName, { name: 'Test' });
    assert.strictEqual(doc.id, '0_custom_12_xyz');
});
