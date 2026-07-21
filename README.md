# Segmon

[![npm](https://img.shields.io/npm/v/segmon)](https://www.npmjs.com/package/segmon)

*A lightweight, high performance segmented JSON database with custom IDs, dual-size limits, and flexible filtering and pagination.*

Segmon is suitable for:
- Small to medium projects requiring structured JSON-based storage.
- Applications where fully-fledged NoSQL solutions like MongoDB are unnecessary, but basic filesystem storage is insufficient.
- Command-line interfaces (CLIs) requiring atomic write operations.
- Rapid prototyping with zero external dependencies.

---

## Table of Contents

- [Segmon](#segmon)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
  - [Installation](#installation)
  - [Usage](#usage)
    - [Initialization](#initialization)
    - [CRUD Operations](#crud-operations)
    - [Advanced Querying](#advanced-querying)
      - [Range Queries](#range-queries)
      - [Custom Filter Functions](#custom-filter-functions)
      - [Global Filter Override](#global-filter-override)
  - [Performance Benchmarks](#performance-benchmarks)
    - [Key Operations Comparison](#key-operations-comparison)
    - [Runtime Highlights](#runtime-highlights)
    - [Running Benchmarks](#running-benchmarks)
  - [Testing](#testing)
    - [Note:](#note)
  - [API Reference](#api-reference)
    - [Configuration Options](#configuration-options)
    - [Core Methods](#core-methods)
  - [License](#license)

---

## Features

- **Dual Segmentation**: Split collections based on file size limit (`segmentSize`) or maximum item count (`maxItemsPerSegment`), whichever limit is reached first.
- **Custom ID Generation**: Provide a custom ID generator (e.g., UUID, NanoID) or configure the length of the default alphanumeric generator.
- **Optimized Bulk Operations**: Create, update, read, and delete documents in batches to minimize disk I/O.
- **Flexible Queries**: Perform queries using exact matches, range queries (for numbers and dates), case-insensitive string sub-matches, custom match functions, or full query overrides.
- **Pagination**: Restrict query result size and offset results directly via parameters (`limit` and `offset`).
- **Atomic Writes**: Safe, collection-level locking ensures that concurrent writes do not cause file corruption.

---

## Installation

Install via npm:

```bash
npm install segmon
```

---

## Usage

### Initialization

```javascript
import Segmon from 'segmon';

const db = new Segmon({
  basePath: './data',           // Directory where collections will be stored
  segmentSize: 50000,           // Maximum size per segment file in bytes (default: 50KB)
  maxItemsPerSegment: 1000,     // Maximum documents per segment file (optional)
  idLength: 8,                  // Length of generated IDs (default: 6)
  idGenerator: (length) => ...  // Custom ID generator function (optional)
  onFilter: (doc, filter) => ... // Custom matching logic override (optional)
});
```

### CRUD Operations

```javascript
// Create
const user = await db.create('users', { name: 'Alice', age: 30 });

// Bulk Create
await db.bulkCreate('users', [
  { name: 'Bob', age: 25 },
  { name: 'Charlie', age: 35 }
]);

// Find with filters and pagination
const activeUsers = await db.find(
  'users',
  { age: { min: 18, max: 35 } },
  { limit: 10, offset: 0 }
);

// Find single document by ID
const foundUser = await db.findById('users', user.id);

// Update
await db.update('users', user.id, { age: 31 });

// Delete
await db.delete('users', user.id);
```

### Advanced Querying

#### Range Queries
Perform range queries on numbers or JavaScript `Date` objects using `min` and `max`:

```javascript
const usersInRange = await db.find('users', {
  age: { min: 21, max: 65 },
  joined: { min: new Date('2025-01-01') }
});
```

#### Custom Filter Functions
Pass custom callback matchers for specific fields:

```javascript
const oddAges = await db.find('users', {
  age: (val) => val % 2 !== 0
});
```

#### Global Filter Override
Apply a custom query matching engine during initialization:

```javascript
const db = new Segmon({
  onFilter: (doc, filter) => doc.tags?.includes(filter.tag)
});

// Queries will now invoke the custom onFilter logic
const taggedPosts = await db.find('posts', { tag: 'javascript' });
```

---

## Performance Benchmarks

Segmon delivers high performance across JavaScript environments. In benchmark suites, the Bun runtime demonstrates exceptional speed advantages:

### Key Operations Comparison

| Operation | 100 Docs (Node/Bun) | 10K Docs (Node/Bun) | Bun Performance Advantage |
| --- | --- | --- | --- |
| **Insert** | 5.11ms / 10.55ms | 121.24ms / 96.28ms | 20% faster at scale |
| **Query** | 2.18ms / 2.30ms | 56.51ms / 40.82ms | 28% faster |
| **Update** | 2.32ms / 1.45ms | 1.26ms / 1.12ms | 15-40% faster |
| **Delete** | 1.91ms / 1.25ms | 1.04ms / 0.88ms | 15-35% faster |

### Pagination Method Comparison (10,000 Documents)

| Pagination Method | Query Time | Performance Advantage |
| --- | --- | --- |
| **Traditional Offset** (`offset: 9980`) | 77.15ms | Baseline |
| **Keyset Cursor** (`latestItemFetched: ID`) | 1.72ms | **45x faster** (saves 98% processing time) |

### Runtime Highlights

- **Bun Integration**: Bun provides substantial performance benefits (20% to 28% faster) when handling larger databases with over 10,000 documents.
- **Node.js**: Node.js exhibits slightly lower overhead and latency for small, localized datasets (<1,000 documents).
- **Updates and Deletes**: Single document modification and deletion operations are consistently executed in under 2 milliseconds across both runtimes.

### Running Benchmarks

To run the benchmarking suite locally:

```bash
# Clone the repository
git clone https://github.com/neon-x-hub/segmon.git
cd segmon

# Run the benchmark script
node benchmark/bench.js
```

*Benchmark Environment:*
- System: 16GB RAM / NVMe SSD
- Runtimes: Node.js v20.9.0 vs Bun v1.1.16

---

## Testing

Segmon is equipped with a comprehensive test suite covering basic CRUD, bulk operations, advanced query filtering, pagination, dual segmentation limits, concurrent writes, and custom ID generation. 

Tests run using Node.js's native test runner (requiring zero external devDependencies):

```bash
# Run tests
npm test
```

Or run the test file directly:

```bash
node --test tests/segmon.test.js
```

---

## API Reference

### Configuration Options

The `Segmon` constructor accepts the following options:

| Parameter | Type | Default Value | Description |
| --- | --- | --- | --- |
| `basePath` | `string` | `"./segmon-data"` | Path to the directory where collection data is saved |
| `segmentSize` | `number` | `51200` (50KB) | Maximum segment file size in bytes |
| `maxItemsPerSegment` | `number` | `null` | Maximum documents per segment file (overrides size limit if reached first) |
| `idLength` | `number` | `6` | Length of auto-generated alphanumeric IDs |
| `idGenerator` | `function` | `generateId` | Custom function returning a unique ID: `(idLength) => string` |
| `onFilter` | `function` | `null` | Custom filter engine matching function: `(doc, filter) => boolean` |
| `normaliseDocument` | `function` | `(doc) => doc` | Preprocessor to run on documents prior to query filtering |

### Core Methods

| Method | Description | Bulk Variant |
| --- | --- | --- |
| `create(collection, data)` | Inserts a new document | `bulkCreate(collection, array)` |
| `find(collection, filter, options)` | Searches for documents matching the filter | - |
| `findById(collection, id)` | Retrieves a single document by its ID | `bulkFindByIds(collection, ids)` |
| `update(collection, id, changes)` | Merges changes into a document | `bulkUpdate(collection, updates)` |
| `delete(collection, id)` | Deletes a document by ID | `bulkDelete(collection, ids)` |

#### `find` Options

The third parameter of the `find` method is an optional object supporting the following pagination properties:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `limit` | `number` | `Infinity` | Maximum number of matching documents to return. |
| `offset` | `number` | `0` | Traditional pagination offset (scans all preceding items). |
| `scanDirection` | `string` | `'forward'` | Direction to scan segments: `'forward'` (first to last) or `'backward'` (last to first). |
| `latestItemFetched` | `string` | `null` | The ID of the last document fetched. Enables fastKeyset / cursor pagination. |

---

## License

MIT © Memmou Abderrahmane (neon-x-hub)
