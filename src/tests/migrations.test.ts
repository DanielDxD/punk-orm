/**
 * Migration tests — SchemaDiffer + MigrationManager
 *
 * All tests use `:memory:` so they are fast and side-effect free.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import "reflect-metadata";
import {
    BunSQLiteAdapter,
    Column,
    Entity,
    MigrationManager,
    PrimaryGeneratedColumn,
    SchemaDiffer,
    metadataStorage
} from "../index.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

type TestAdapter = BunSQLiteAdapter;

function freshAdapter(): TestAdapter {
    return new BunSQLiteAdapter(":memory:");
}

/**
 * Create every table in metadataStorage that is NOT in `skipTables`.
 * This prevents false positives when the singleton has entities from other
 * test files loaded in the same bun process.
 */
async function createOtherTables(db: TestAdapter, skipTables: Set<string>): Promise<void> {
    for (const meta of metadataStorage.getAllEntities()) {
        if (skipTables.has(meta.tableName)) continue;
        const cols = meta.columns
            .map((c) => {
                let def = `${c.columnName} TEXT`;
                if (c.isPrimary) def += " PRIMARY KEY";
                return def;
            })
            .join(", ");
        // Ignore errors — table may already exist or be missing constraints we don't care about
        await db
            .run(`CREATE TABLE IF NOT EXISTS ${meta.tableName} (${cols})`)
            .catch(() => undefined);
    }
}

// ── Test entities (isolated table names to avoid cross-test pollution) ─────────

@Entity("mig_users")
class MigUser {
    @PrimaryGeneratedColumn("uuid")
    public id!: string;

    @Column({ type: "text" })
    public name!: string;

    @Column({ type: "text", unique: true })
    public email!: string;
}

@Entity("mig_posts")
class MigPost {
    @PrimaryGeneratedColumn("uuid")
    public id!: string;

    @Column({ type: "text" })
    public title!: string;

    @Column({ type: "text" })
    public authorId!: string;
}

// Register them (decorators already do this, but explicit for clarity)
void MigUser;
void MigPost;

// ── SchemaDiffer tests ────────────────────────────────────────────────────────

describe("SchemaDiffer", () => {
    let db: TestAdapter;
    let differ: SchemaDiffer;

    beforeEach(() => {
        db = freshAdapter();
        differ = new SchemaDiffer(db);
    });

    afterEach(() => {
        db.close();
    });

    it("detects new tables when DB is empty", async () => {
        const diff = await differ.diff();
        const names = diff.tablesToCreate.map((e) => e.tableName);
        expect(names).toContain("mig_users");
        expect(names).toContain("mig_posts");
        expect(diff.columnsToAdd.length).toBe(0);
        expect(diff.columnsToDrop.length).toBe(0);
    });

    it("reports in-sync after creating all tables", async () => {
        await db.run(`CREATE TABLE IF NOT EXISTS mig_users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
        )`);
        await db.run(`CREATE TABLE IF NOT EXISTS mig_posts (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            authorId TEXT NOT NULL
        )`);
        // Cover any other entities registered from other test files
        await createOtherTables(db, new Set(["mig_users", "mig_posts"]));

        const inSync = await differ.isInSync();
        expect(inSync).toBe(true);
    });

    it("detects a column missing from the DB (columnsToAdd)", async () => {
        // mig_users WITHOUT 'email'
        await db.run(`CREATE TABLE IF NOT EXISTS mig_users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        )`);
        // mig_posts fully present
        await db.run(`CREATE TABLE IF NOT EXISTS mig_posts (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            authorId TEXT NOT NULL
        )`);
        await createOtherTables(db, new Set(["mig_users", "mig_posts"]));

        const diff = await differ.diff();
        const added = diff.columnsToAdd.map((c) => `${c.entity.tableName}.${c.column.columnName}`);
        expect(added).toContain("mig_users.email");
        expect(diff.tablesToCreate.length).toBe(0);
        expect(diff.columnsToDrop.length).toBe(0);
    });

    it("detects a column in DB that is gone from metadata (columnsToDrop)", async () => {
        // mig_users with extra 'legacy_col' not in metadata
        await db.run(`CREATE TABLE mig_users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            legacy_col TEXT
        )`);
        await db.run(`CREATE TABLE mig_posts (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            authorId TEXT NOT NULL
        )`);
        await createOtherTables(db, new Set(["mig_users", "mig_posts"]));

        const diff = await differ.diff();
        const dropped = diff.columnsToDrop.map((c) => `${c.entity.tableName}.${c.columnName}`);
        expect(dropped).toContain("mig_users.legacy_col");
        expect(diff.columnsToDrop.length).toBe(1);
    });

    it("generateSQL produces valid CREATE TABLE statements", async () => {
        const diff = await differ.diff();
        const { upStatements, downStatements } = await differ.generateSQL(diff);

        expect(upStatements.length).toBeGreaterThanOrEqual(2);
        expect(upStatements.some((s) => s.includes("CREATE TABLE IF NOT EXISTS mig_users"))).toBe(
            true
        );
        expect(downStatements.some((s) => s.includes("DROP TABLE IF EXISTS mig_users"))).toBe(true);
    });

    it("generateSQL produces ALTER TABLE ADD COLUMN for missing columns", async () => {
        await db.run(`CREATE TABLE mig_users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        )`);
        await db.run(`CREATE TABLE mig_posts (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            authorId TEXT NOT NULL
        )`);
        await createOtherTables(db, new Set(["mig_users", "mig_posts"]));

        const diff = await differ.diff();
        const { upStatements, downStatements } = await differ.generateSQL(diff);

        expect(upStatements.some((s) => s.includes("ALTER TABLE mig_users ADD COLUMN email"))).toBe(
            true
        );
        expect(
            downStatements.some((s) => s.includes("ALTER TABLE mig_users DROP COLUMN email"))
        ).toBe(true);
    });

    it("generateSQL produces ALTER TABLE DROP COLUMN for extra DB columns", async () => {
        await db.run(`CREATE TABLE mig_users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            legacy_col TEXT
        )`);
        await db.run(`CREATE TABLE mig_posts (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            authorId TEXT NOT NULL
        )`);
        await createOtherTables(db, new Set(["mig_users", "mig_posts"]));

        const diff = await differ.diff();
        const { upStatements, downStatements } = await differ.generateSQL(diff);

        expect(
            upStatements.some((s) => s.includes("ALTER TABLE mig_users DROP COLUMN legacy_col"))
        ).toBe(true);
        expect(
            downStatements.some((s) => s.includes("ALTER TABLE mig_users ADD COLUMN legacy_col"))
        ).toBe(true);
    });
});

// ── MigrationManager tests ────────────────────────────────────────────────────

// Absolute paths to ORM source — required because temp files live in /tmp
const MIGRATION_BASE_PATH = path.resolve(import.meta.dir, "../migrations/Migration.ts");
const ADAPTER_TYPE_PATH = path.resolve(import.meta.dir, "../connection/DatabaseAdapter.ts");

/**
 * Write a temporary migration file using absolute import paths so it can be
 * resolved even when loaded from an OS temp directory.
 */
async function writeTempMigration(
    dir: string,
    filename: string,
    className: string,
    upSQL: string,
    downSQL: string
): Promise<string> {
    const content = `import { Migration } from "${MIGRATION_BASE_PATH}";
import type { IDatabaseAdapter } from "${ADAPTER_TYPE_PATH}";

export class ${className} extends Migration {
    public async up(db: IDatabaseAdapter): Promise<void> {
        await db.run(\`${upSQL}\`);
    }
    public async down(db: IDatabaseAdapter): Promise<void> {
        await db.run(\`${downSQL}\`);
    }
}
`;
    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, content, "utf-8");
    return filePath;
}

describe("MigrationManager", () => {
    let db: TestAdapter;
    let manager: MigrationManager;
    let tmpDir: string;

    beforeEach(async () => {
        db = freshAdapter();
        manager = new MigrationManager(db);
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "punk-migrations-test-"));
    });

    afterEach(async () => {
        db.close();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("ensureTable creates _punk_migrations", async () => {
        await manager.ensureTable();
        const tables = await db.query<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='_punk_migrations'"
        );
        expect(tables.length).toBe(1);
    });

    it("getExecuted returns empty array on fresh DB", async () => {
        const rows = await manager.getExecuted();
        expect(rows).toEqual([]);
    });

    it("getPending returns all files when none executed", async () => {
        await writeTempMigration(
            tmpDir,
            "20260101_000000_alpha.ts",
            "Alpha",
            "CREATE TABLE IF NOT EXISTS alpha (id INTEGER PRIMARY KEY)",
            "DROP TABLE IF EXISTS alpha"
        );
        const pending = await manager.getPending(tmpDir);
        expect(pending.length).toBe(1);
        expect(pending[0]).toContain("20260101_000000_alpha");
    });

    it("runAll applies migrations and records them", async () => {
        await writeTempMigration(
            tmpDir,
            "20260101_000000_alpha.ts",
            "Alpha20260101000000",
            "CREATE TABLE IF NOT EXISTS alpha (id INTEGER PRIMARY KEY)",
            "DROP TABLE IF EXISTS alpha"
        );

        const applied = await manager.runAll(tmpDir);
        expect(applied).toContain("20260101_000000_alpha");

        const executed = await manager.getExecuted();
        expect(executed.length).toBe(1);
        expect(executed[0]!.name).toBe("20260101_000000_alpha");
    });

    it("getPending returns only un-run migrations", async () => {
        await writeTempMigration(
            tmpDir,
            "20260101_000000_alpha.ts",
            "Alpha20260101000000",
            "CREATE TABLE IF NOT EXISTS alpha (id INTEGER PRIMARY KEY)",
            "DROP TABLE IF EXISTS alpha"
        );
        await writeTempMigration(
            tmpDir,
            "20260101_000001_beta.ts",
            "Beta20260101000001",
            "CREATE TABLE IF NOT EXISTS beta (id INTEGER PRIMARY KEY)",
            "DROP TABLE IF EXISTS beta"
        );

        await manager.runAll(tmpDir);

        // Add a new pending migration after running
        await writeTempMigration(
            tmpDir,
            "20260101_000002_gamma.ts",
            "Gamma20260101000002",
            "CREATE TABLE IF NOT EXISTS gamma (id INTEGER PRIMARY KEY)",
            "DROP TABLE IF EXISTS gamma"
        );

        const pending = await manager.getPending(tmpDir);
        expect(pending.length).toBe(1);
        expect(pending[0]).toContain("20260101_000002_gamma");
    });

    it("rollback reverses a specific migration", async () => {
        await writeTempMigration(
            tmpDir,
            "20260101_000000_alpha.ts",
            "Alpha20260101000000",
            "CREATE TABLE IF NOT EXISTS alpha (id INTEGER PRIMARY KEY)",
            "DROP TABLE IF EXISTS alpha"
        );

        await manager.runAll(tmpDir);

        const before = await db.query<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='alpha'"
        );
        expect(before.length).toBe(1);

        await manager.rollback(tmpDir, "20260101_000000_alpha");

        const after = await db.query<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='alpha'"
        );
        expect(after.length).toBe(0);

        const executed = await manager.getExecuted();
        expect(executed.length).toBe(0);
    });

    it("flush rolls back all migrations in reverse order", async () => {
        await writeTempMigration(
            tmpDir,
            "20260101_000000_alpha.ts",
            "Alpha20260101000000",
            "CREATE TABLE IF NOT EXISTS alpha (id INTEGER PRIMARY KEY)",
            "DROP TABLE IF EXISTS alpha"
        );
        await writeTempMigration(
            tmpDir,
            "20260101_000001_beta.ts",
            "Beta20260101000001",
            "CREATE TABLE IF NOT EXISTS beta (id INTEGER PRIMARY KEY)",
            "DROP TABLE IF EXISTS beta"
        );

        await manager.runAll(tmpDir);
        await manager.flush(tmpDir);

        const executed = await manager.getExecuted();
        expect(executed.length).toBe(0);

        const tables = await db.query<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('alpha', 'beta')"
        );
        expect(tables.length).toBe(0);
    });

    it("rollback throws when migration name is not in executed list", async () => {
        await expect(manager.rollback(tmpDir, "nonexistent_migration")).rejects.toThrow(
            /not found in executed migrations/
        );
    });
});
