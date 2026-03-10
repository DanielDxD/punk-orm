import type { IDatabaseAdapter } from "../src/index.ts";
import { Migration } from "../src/index.ts";

export class FixAuthorIdType extends Migration {
  public async up(db: IDatabaseAdapter): Promise<void> {
    await db.run(`CREATE TABLE IF NOT EXISTS "users" (
    "id" UUID PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "score" INTEGER NOT NULL DEFAULT 0
  )`);
    await db.run(`CREATE TABLE IF NOT EXISTS "posts" (
    "id" UUID PRIMARY KEY,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "authorId" UUID NOT NULL,
    FOREIGN KEY ("authorId") REFERENCES "users"("id")
  )`);
  }

  public async down(db: IDatabaseAdapter): Promise<void> {
    await db.run(`DROP TABLE IF EXISTS "posts"`);
    await db.run(`DROP TABLE IF EXISTS "users"`);
  }
}
