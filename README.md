# **Segmon** 🗃️
[![npm](https://img.shields.io/npm/v/segmon)](https://www.npmjs.com/package/segmon)

*A lightweight, high performance segmented JSON database with custom IDs, dual-size limits, and flexible filtering and pagination.*

Perfect for:
✅ **Small to medium projects** needing structured storage
✅ **Apps where MongoDB is overkill** but filesystem storage is too basic
✅ **CLI tools** requiring fast, atomic operations
✅ **Prototyping** with zero dependencies

---

## **📑 Table of Contents**

1. **[✨ Features](#-features)**
   - Dual Segmentation
   - Custom ID Generation
   - Bulk Operations
   - Flexible Queries
   - Atomic Writes

2. **[🚀 Install](#-install)**

3. **[📖 Usage](#-usage)**
   - Initialization
   - CRUD Operations
   - Advanced Queries

4. **[🚀 Performance Benchmarks](#-performance-benchmarks)**
   - Key Operations Comparison
   - Runtime Highlights
   - Benchmark Execution

5. **[🛠 API Reference](#-api-reference)**
   - Configuration Options
   - Core Methods

6. **[📜 License](#-license)**
---

## **✨ Features**

- **Dual Segmentation**
  Limit by file size (`segmentSize`) **or** item count (`maxItemsPerSegment`).

- **Custom ID Generation**
  Bring your own ID logic (UUIDs, nanoid, etc.) or use the built-in generator with custom ID length.

- **Optimized Bulk Operations**
  Insert/update/delete multiple documents with minimal I/O.

- **Flexible Queries**
  Filter with:
  - **Ranges**: `{ age: { min: 18, max: 30 } }`
  - **Custom logic**: `onFilter: (doc, filter) => ...`
  - **Deep matching**: Nested object/array support.
  - **Built-in Pagination**: `db.find(collection, {} ,{limit: 10, offset: 50})`

- **Atomic Writes**
  File-level locking prevents corruption.

---

## **🚀 Install**

```bash
npm install segmon
```

---

## **📖 Usage**

### **1. Initialize**
```javascript
import Segmon from 'segmon';

const db = new Segmon({
  basePath: './data',           // Storage directory
  segmentSize: 50000,           // 50KB per file (optional)
  maxItemsPerSegment: 1000,     // OR max docs per file (optional)
  idGenerator: customIdFn,      // Optional: () => 'your-id'
  onFilter: customFilter        // Override default filtering
});
```

### **2. CRUD Operations**
```javascript
// Create
const user = await db.create('users', { name: 'Alice', age: 30 });

// Bulk insert
await db.bulkCreate('users', [...largeArray]);

// Query
const adults = await db.find('users', { age: { min: 18 } }, { limit: 10 });

// Update
await db.update('users', user.id, { age: 31 });

// Delete
await db.delete('users', user.id);
```

### **3. Advanced Queries**
```javascript
// Custom filter function
const db = new Segmon({
  onFilter: (doc, filter) => doc.tags?.includes(filter.tag)
});

// Find all docs with 'special' tag
await db.find('posts', { tag: 'special' });
```

---

## **🚀 Performance Benchmarks**

Segmon delivers exceptional performance across JavaScript runtimes, with Bun showing particularly impressive results:

### **Key Operations Comparison**
| Operation  | 100 Docs (Node/Bun)  | 10K Docs (Node/Bun)    | Bun Advantage           |
| ---------- | -------------------- | ---------------------- | ----------------------- |
| **Insert** | 5.11ms / **10.55ms** | 121.24ms / **96.28ms** | **20% faster** at scale |
| **Query**  | 2.18ms / **2.30ms**  | 56.51ms / **40.82ms**  | **28% faster**          |
| **Update** | 2.32ms / **1.45ms**  | 1.26ms / **1.12ms**    | **15-40% faster**       |
| **Delete** | 1.91ms / **1.25ms**  | 1.04ms / **0.88ms**    | **15-35% faster**       |

**✨ Runtime Highlights:**
- **Bun dominates** at scale with 20-28% faster operations for large datasets
- **Node.js shows** slightly better performance for small datasets (<1,000 docs)
- **Update/Delete operations** are consistently fast (<2ms) in both runtimes

### **What Makes These Results Fire**
1. **10K Document Benchmark**
   - Bun completes bulk inserts in **<100ms** (vs 121ms in Node)
   - Demonstrates Segmon's optimized segmentation system

2. **Real-World Ready**
   - Sub-2ms updates/deletes mean perfect fit for:
     - High-traffic APIs
     - Real-time applications
     - Data-intensive scripts

3. **Runtime Flexibility**
```bash
   # Works beautifully in both environments
   node your-app.js
   bun your-app.js
```

*Test Environment:*
- 16GB RAM / NVMe SSD
- Clean database state for all tests
- Node.js v20.9.0 vs Bun v1.1.16


### How to Run Benchmarks

1. Clone the repository:
```bash
   git clone https://github.com/neon-x-hub/segmon.git
   cd segmon
```

2. Run the benchmark script
```bash
    # or use `bun` if you want
    node benchmark/bench.js
```

### Note:

Benchmarks measure cold-start operations on a clean database. Your results may vary based on:
• Hardware specifications (SSD vs HDD)
• Node.js version
• System load during testing

---

## **🛠 API Reference**

### **`new Segmon(config)` Configuration Options**

| Parameter             | Type       | Default Value       | Description                                                                 |
|-----------------------|------------|---------------------|-----------------------------------------------------------------------------|
| `basePath`           | `string`   | `"./segmon-data"`   | Base directory where collections will be stored                             |
| `segmentSize`        | `number`   | `51200` (50KB)      | Maximum size of each segment file in bytes                                  |
| `maxItemsPerSegment` | `number`   | `null` (unlimited)  | Maximum number of documents per segment file (overrides size limit if set)  |
| `idGenerator`        | `function` | `generateId`        | Custom function to generate document IDs: `() => string`                    |
| `idLength`           | `number`   | `6`                 | Length of auto-generated IDs (when using default generator)                 |
| `onFilter`           | `function` | `null`              | Custom filter function: `(doc, filter) => boolean`                          |
| `normaliseDocument`  | `function` | `(doc) => doc`      | Document pre-processor function applied before storage/querying             |

**Notes:**
- Either `segmentSize` or `maxItemsPerSegment` can limit segmentation
- When both are set, whichever limit is hit first triggers new segment creation
- `idGenerator` receives no arguments and should return a unique string
- `normaliseDocument` runs on all documents before they're filtered


### **Core Methods**
| Method                            | Description                             | Bulk Version                      |
| --------------------------------- | --------------------------------------- | --------------------------------- |
| `create(collection, data)`        | Insert a single document                | `bulkCreate(collection, array)`   |
| `find(collection, filter, opts)`  | Query documents with optional filtering | -                                 |
| `findById(collection, id)`        | Fetch a single document by ID           | `bulkFindByIds(collection, ids)`  |
| `update(collection, id, changes)` | Modify a single document                | `bulkUpdate(collection, updates)` |
| `delete(collection, id)`          | Remove a single document                | `bulkDelete(collection, ids)`     |

**Key Features:**
- **Bulk operations** are more optimized for batch processing
- **Filtering and Pagination** automatically supported by find method
- **Atomic writes** ensure data integrity
- **Segment-aware** queries automatically scan all relevant files

---

## **📜 License**
MIT © Memmou Abderrahmane (neon-x-hub)

---

**Enjoy Segmon?** ⭐️ [GitHub Repo](https://github.com/neon-x-hub/segmon) | Report issues [here](#).
