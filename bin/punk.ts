#!/usr/bin/env bun
/**
 * PunkORM CLI — punk
 *
 * Usage:
 *   punk init                                 Scaffold punk.config.ts + migrations/
 *   punk generate migration --name <name>     Generate a migration from entity diff
 *   punk run migration                        Run all pending migrations
 *   punk rollback migration --name <name>     Rollback a specific migration
 *   punk flush migrations                     Rollback all migrations
 *   punk status                               Show migration status
 */
import * as path from "path";
import type { IDatabaseAdapter } from "../src/connection/DatabaseAdapter.ts";
import { MigrationManager, classNameFromFile } from "../src/migrations/MigrationManager.ts";
import { SchemaDiffer } from "../src/migrations/SchemaDiffer.ts";
import { Logger } from "../src/utils/logger.ts";

// ── Config ────────────────────────────────────────────────────────────────────

interface PunkConfig {
    adapter: IDatabaseAdapter;
    migrationsDir?: string;
    /** Override the import path used in generated migrations. Defaults to auto-detect. */
    ormImport?: string;
}

async function loadConfig(): Promise<PunkConfig> {
    const configPath = path.resolve(process.cwd(), "punk.config.ts");
    const exists = await Bun.file(configPath).exists();

    if (!exists) {
        Logger.error("punk.config.ts not found.", "CLI");
        Logger.logAny("   Run `punk init` to scaffold one, or create it manually:\n\n" +
            "   import { BunSQLiteAdapter } from \"./src/index.ts\";\n" +
            "   import \"./src/main.ts\"; // registers your entities\n\n" +
            "   export default {\n" +
            "     adapter: new BunSQLiteAdapter(\"./app.db\"),\n" +
            "     migrationsDir: \"./migrations\",\n" +
            "   };", "CLI");
        process.exit(1);
    }

    const mod = (await import(configPath)) as { default?: PunkConfig };
    const config = mod.default;

    if (!config || !config.adapter) {
        Logger.error("punk.config.ts must export a default object with an `adapter` property.", "CLI");
        process.exit(1);
    }

    return {
        adapter: config.adapter,
        migrationsDir: config.migrationsDir ?? "./migrations",
        ormImport: config.ormImport,
    };
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

function getArg(args: Array<string>, flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
}

function printHelp() {
    Logger.info("PunkORM CLI", "CLI");
    Logger.logAny(`
Usage:
  punk <command> [options]

Commands:
  init                               Scaffold punk.config.ts and migrations/
  generate migration --name <name>   Generate a migration based on entity schema diff
  run migration                      Run all pending migrations
  rollback migration --name <name>   Roll back a specific migration
  flush migrations                   Roll back all executed migrations
  status                             Show migration status

Examples:
  punk init
  punk generate migration --name create_users
  punk run migration
  punk rollback migration --name 20260309_181300_create_users
  punk flush migrations
  punk status
`, "CLI");
}

// ── Timestamp ─────────────────────────────────────────────────────────────────

function timestamp(): string {
    const now = new Date();
    const pad = (n: number, d = 2) => String(n).padStart(d, "0");
    return (
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
        `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    );
}

// ── init ──────────────────────────────────────────────────────────────────────

async function initProject() {
    const configPath = path.resolve(process.cwd(), "punk.config.ts");
    const migrationsDir = path.resolve(process.cwd(), "migrations");
    const gitkeepPath = path.join(migrationsDir, ".gitkeep");

    // Guard: don't overwrite existing config
    if (await Bun.file(configPath).exists()) {
        Logger.warn("punk.config.ts already exists — skipping.", "CLI");
    } else {
        const template = `import { 
  BunSQLiteAdapter, 
  // PostgresAdapter, 
  // MySqlAdapter, 
  // MsSqlAdapter 
} from "@danielgl/punk-orm";

// import "./src/entities/User.ts"; // ← Import your entities here to register them

export default {
  /**
   * Database Adapter configuration.
   * Choose the one that matches your database.
   */
  adapter: new BunSQLiteAdapter("./app.db"),
  
  /**
   * Directory where migration files will be stored.
   */
  migrationsDir: "./migrations",

  /**
   * Configuration for the DataContext.
   */
  options: {
    logging: ["query", "error"], // Options: true, false, "query", "error", "info", "warn"
    autoMigrations: true,
  }
};
`;
        await Bun.write(configPath, template);
        Logger.success("Created punk.config.ts", "CLI");
    }

    // Create migrations dir with .gitkeep
    if (!(await Bun.file(gitkeepPath).exists())) {
        await Bun.write(gitkeepPath, "");
        Logger.success("Created migrations/.gitkeep", "CLI");
    } else {
        Logger.info("migrations/ already exists — skipping.", "CLI");
    }

    // Check package.json for the 'punk' script
    const pkgPath = path.resolve(process.cwd(), "package.json");
    let scriptSuggestion = "";
    if (await Bun.file(pkgPath).exists()) {
        const pkg = await Bun.file(pkgPath).json();
        if (!pkg.scripts || !pkg.scripts.punk) {
            scriptSuggestion =
                "    !!! Add this to your package.json scripts:\n" +
                "        \"punk\": \"bun node_modules/@danielgl/punk-orm/bin/punk.ts\"\n\n";
        }
    }

    Logger.logAny(
        "\n  Next steps:\n" +
        scriptSuggestion +
        "    1. Edit punk.config.ts — set your adapter and import your entity files.\n" +
        "    2. bun punk generate migration --name initial_schema\n" +
        "    3. bun punk run migration\n", "CLI"
    );
}

// ── generate migration ────────────────────────────────────────────────────────

async function generateMigration(config: PunkConfig, name: string) {
    const adapter = config.adapter;
    const migrationsDir = path.resolve(config.migrationsDir!);

    await adapter.ensureDatabaseExists();

    Logger.info("Diffing schema against database...", "CLI");

    // Compute diff once — reuse for isInSync, generateSQL, and summary display
    const differ = new SchemaDiffer(adapter);
    const diff = await differ.diff();
    const inSync = await differ.isInSync(diff);

    if (inSync) {
        Logger.success("Schema is already in sync. Nothing to migrate.", "CLI");
        adapter.close();
        return;
    }

    const { upStatements, downStatements } = await differ.generateSQL(diff);

    const ts = timestamp();
    const fileName = `${ts}_${name}.ts`;
    const className = classNameFromFile(fileName);
    const filePath = path.join(migrationsDir, fileName);

    const upBody = upStatements.map((sql) => `    await db.run(\`${sql.replace(/`/g, "\\`")}\`);`).join("\n");
    const downBody = downStatements.map((sql) => `    await db.run(\`${sql.replace(/`/g, "\\`")}\`);`).join("\n");

    // Resolve the ORM import path:
    // - user-specified override wins
    // - else if @danielgl/punk-orm is installed as a package, use that
    // - else fall back to the relative path from the project root
    let ormImportPath = config.ormImport;
    if (!ormImportPath) {
        const pkgJsonPath = path.resolve(process.cwd(), "node_modules/@danielgl/punk-orm/package.json");
        const pkgInstalled = await Bun.file(pkgJsonPath).exists();
        ormImportPath = pkgInstalled ? "@danielgl/punk-orm" : "./src/index.ts";
    }

    // Compute relative import path from the migrations dir to the resolved path
    let finalImport = ormImportPath;
    if (!ormImportPath.startsWith("@") && !path.isAbsolute(ormImportPath)) {
        finalImport = path.relative(migrationsDir, path.resolve(process.cwd(), ormImportPath));
        if (!finalImport.startsWith(".")) finalImport = "." + path.sep + finalImport;
    }

    const content = `import type { IDatabaseAdapter } from "${finalImport}";
import { Migration } from "${finalImport}";

export class ${className} extends Migration {
  public async up(db: IDatabaseAdapter): Promise<void> {
${upBody}
  }

  public async down(db: IDatabaseAdapter): Promise<void> {
${downBody}
  }
}
`;

    // Ensure migrations dir exists
    await Bun.write(filePath, content);

    Logger.success("Migration generated:", "CLI");
    Logger.log(`   ${filePath}`, "CLI");
    Logger.info("Changes detected:", "CLI");

    for (const e of diff.tablesToCreate) {
        Logger.log(`   + CREATE TABLE ${e.tableName}`, "CLI");
    }
    for (const { entity, column } of diff.columnsToAdd) {
        Logger.log(`   + ADD COLUMN ${entity.tableName}.${column.columnName}`, "CLI");
    }
    for (const { entity, columnName } of diff.columnsToDrop) {
        Logger.log(`   - DROP COLUMN ${entity.tableName}.${columnName}`, "CLI");
    }

    adapter.close();
}

// ── run migration ────────────────────────────────────────────────────────────

async function runMigrations(config: PunkConfig) {
    const adapter = config.adapter;
    const migrationsDir = path.resolve(config.migrationsDir!);

    Logger.info(`Running pending migrations from ${migrationsDir}...`, "CLI");

    const manager = new MigrationManager(adapter);
    const applied = await manager.runAll(migrationsDir);

    if (applied.length > 0) {
        Logger.success(`Applied ${applied.length} migration(s).`, "CLI");
    }

    adapter.close();
}

// ── rollback migration ────────────────────────────────────────────────────────

async function rollbackMigration(config: PunkConfig, name: string) {
    const adapter = config.adapter;
    const migrationsDir = path.resolve(config.migrationsDir!);
    Logger.info(`Rolling back migration: ${name}`, "CLI");

    const manager = new MigrationManager(adapter);
    await manager.rollback(migrationsDir, name);
    Logger.success("Done", "CLI");

    adapter.close();
}

// ── flush migrations ──────────────────────────────────────────────────────────

async function flushMigrations(config: PunkConfig) {
    const adapter = config.adapter;
    const migrationsDir = path.resolve(config.migrationsDir!);
    Logger.info("Flushing all migrations...", "CLI");

    const manager = new MigrationManager(adapter);
    await manager.flush(migrationsDir);
    Logger.success("All migrations rolled back.", "CLI");

    adapter.close();
}

// ── status ────────────────────────────────────────────────────────────────────

async function migrationStatus(config: PunkConfig) {
    const adapter = config.adapter;
    const migrationsDir = path.resolve(config.migrationsDir!);
    const manager = new MigrationManager(adapter);

    const executed = await manager.getExecuted();
    const pending = await manager.getPending(migrationsDir);

    Logger.info("Migration Status", "CLI");

    if (executed.length === 0 && pending.length === 0) {
        Logger.log(`No migrations found in ${migrationsDir}`, "CLI");
    }

    for (const r of executed) {
        Logger.log(`✓  ${r.name}  (ran at ${r.ran_at})`, "CLI");
    }
    for (const f of pending) {
        const name = path.basename(f, ".ts");
        Logger.log(`·  ${name}  (pending)`, "CLI");
    }

    adapter.close();
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
        printHelp();
        return;
    }

    const [cmd, sub, ...rest] = args;

    // punk init
    if (cmd === "init") {
        await initProject();
        return;
    }

    // punk generate migration --name <name>
    if (cmd === "generate" && sub === "migration") {
        const name = getArg(rest, "--name");
        if (!name) {
            Logger.error("Missing --name flag. Usage: punk generate migration --name <name>", "CLI");
            process.exit(1);
        }
        const safeN = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
        const config = await loadConfig();
        await generateMigration(config, safeN);
        return;
    }

    // punk run migration
    if (cmd === "run" && sub === "migration") {
        const config = await loadConfig();
        await runMigrations(config);
        return;
    }

    // punk rollback migration --name <name>
    if (cmd === "rollback" && sub === "migration") {
        const name = getArg(rest, "--name");
        if (!name) {
            Logger.error("Missing --name flag. Usage: punk rollback migration --name <name>", "CLI");
            process.exit(1);
        }
        const config = await loadConfig();
        await rollbackMigration(config, name);
        return;
    }

    // punk flush migrations
    if (cmd === "flush" && sub === "migrations") {
        const config = await loadConfig();
        await flushMigrations(config);
        return;
    }

    // punk status
    if (cmd === "status") {
        const config = await loadConfig();
        await migrationStatus(config);
        return;
    }

    Logger.error(`Unknown command: ${cmd} ${sub ?? ""}`, "CLI");
    printHelp();
    process.exit(1);
}

main().catch((err) => {
    Logger.error(err instanceof Error ? err.message : String(err), "CLI");
    process.exit(1);
});
