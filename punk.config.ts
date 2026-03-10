/**
 * punk.config.ts — PunkORM CLI Configuration
 *
 * The `punk` CLI reads this file to:
 *  - Connect to the database (adapter)
 *  - Know where to find/store migration files (migrationsDir)
 *  - Register entity metadata (via the import of main.ts)
 *
 * Usage:
 *   bun bin/punk.ts generate migration --name initial_schema
 *   bun bin/punk.ts run migration
 *   bun bin/punk.ts rollback migration --name 20260309_181300_initial_schema
 *   bun bin/punk.ts flush migrations
 *   bun bin/punk.ts status
 */
import { PostgresAdapter } from "./src/index.ts";

// Import your entity files to register them in MetadataStorage.
// Any file containing @Entity decorators must be imported here.
import "./src/main.ts";

export default {
    adapter: new PostgresAdapter("postgres://postgres:postgres@localhost:5432/test"),
    migrationsDir: "./migrations",
};
