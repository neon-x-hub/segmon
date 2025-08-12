import Segmon from '../src/provider.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCHMARK_PATH = path.join(__dirname, 'benchmark-data');

async function resetTestDir() {
  await fs.rm(BENCHMARK_PATH, { recursive: true, force: true });
  await fs.mkdir(BENCHMARK_PATH);
}

async function runBenchmark(name, fn) {
  const start = performance.now();
  await fn();
  const time = (performance.now() - start).toFixed(2);
  console.log(`⏱️  ${name.padEnd(25)} ${time} ms`);
}

async function benchmark() {
  await resetTestDir();

  const db = new Segmon({
    basePath: BENCHMARK_PATH,
    segmentSize: 1024 * 50, // 50KB
    maxItemsPerSegment: 100,
    idGenerator: () => `bench_${Math.random().toString(36).slice(2, 8)}`
  });

  const TEST_SIZES = [100, 1_000, 10_000];
  const COLLECTION = 'bench';

  console.log('\n🚀 Running Segmon Benchmarks\n');

  for (const size of TEST_SIZES) {
    console.log(`\n📊 Dataset: ${size.toLocaleString()} documents`);
    console.log('='.repeat(40));

    // Generate test data (without IDs)
    const testPayload = Array.from({ length: size }, (_, i) => ({
      name: `User_${i}`,
      age: Math.floor(Math.random() * 50) + 18,
      active: i % 2 === 0
    }));

    // 1. Bulk Create
    let createdDocs;
    await runBenchmark('bulkCreate', async () => {
      createdDocs = await db.bulkCreate(COLLECTION, testPayload);
    });

    // Get first/last IDs for testing
    const firstDoc = createdDocs[0];
    const middleDoc = createdDocs[Math.floor(size/2)];
    const lastDoc = createdDocs[createdDocs.length-1];

    // 2. Find Operations
    await runBenchmark('find (all)', async () => {
      await db.find(COLLECTION, {});
    });

    await runBenchmark('find (filtered)', async () => {
      await db.find(COLLECTION, { active: true });
    });

    // 3. Update Operations
    await runBenchmark('update (first)', async () => {
      await db.update(COLLECTION, firstDoc.id, { age: 99 });
    });

    await runBenchmark('update (middle)', async () => {
      await db.update(COLLECTION, middleDoc.id, { age: 50 });
    });

    await runBenchmark('update (last)', async () => {
      await db.update(COLLECTION, lastDoc.id, { age: 1 });
    });

    // 4. Delete Operations
    await runBenchmark('delete (first)', async () => {
      await db.delete(COLLECTION, firstDoc.id);
    });

    // Cleanup
    await fs.rm(path.join(BENCHMARK_PATH, COLLECTION), { recursive: true });
  }
}

benchmark().catch(console.error);
