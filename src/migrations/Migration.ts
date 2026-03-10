import type { IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";

/**
 * Abstract base class for all PunkORM migrations.
 *
 * Extend this class and implement `up()` and `down()`.
 * Files should be placed in the configured `migrationsDir`.
 *
 * @example
 * // migrations/20260309_181300_create_users.ts
 * import { Migration } from "@danielgl/punk-orm";
 * import type { IDatabaseAdapter } from "@danielgl/punk-orm";
 *
 * export class CreateUsers extends Migration {
 *   async up(db: IDatabaseAdapter): Promise<void> {
 *     await db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL)`);
 *   }
 *   async down(db: IDatabaseAdapter): Promise<void> {
 *     await db.run(`DROP TABLE IF EXISTS users`);
 *   }
 * }
 */
export abstract class Migration {
    public abstract up(db: IDatabaseAdapter): Promise<void>;
    public abstract down(db: IDatabaseAdapter): Promise<void>;
}
