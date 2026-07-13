// @vitest-environment node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

if (!process.env.DATABASE_URL) {
  const { existsSync } = await import("node:fs");
  const { loadEnvFile } = await import("node:process");
  if (existsSync(".env")) loadEnvFile(".env");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for request migration tests");

describe("parent request migration", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  afterAll(() => pool.end());

  it("preserves legacy rows while mapping statuses and converting yuan decimals to integer cents", async () => {
    const client = await pool.connect();
    const schema = `request_migration_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      await client.query(`CREATE TYPE "RequestStatus" AS ENUM ('DRAFT','OPEN','PAUSED','FILLED','CLOSED')`);
      await client.query(`
        CREATE TABLE "StudentProfile" ("id" uuid PRIMARY KEY);
        CREATE TABLE "TutoringRequest" (
          "id" uuid PRIMARY KEY,
          "budgetMin" decimal(10,2), "budgetMax" decimal(10,2),
          "status" "RequestStatus" NOT NULL,
          "publishedAt" timestamptz(3), "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
          "updatedAt" timestamptz(3) NOT NULL DEFAULT now()
        )
      `);
      const rows = ["DRAFT", "OPEN", "PAUSED", "FILLED", "CLOSED"].map(() => randomUUID());
      for (let index = 0; index < rows.length; index += 1) {
        await client.query(`INSERT INTO "TutoringRequest" ("id","budgetMin","budgetMax","status") VALUES ($1,$2,$3,$4)`, [
          rows[index], index === 0 ? -1 : index === 1 ? 88.88 : 120,
          index === 0 ? 2000 : index === 1 ? 199.99 : 100,
          ["DRAFT", "OPEN", "PAUSED", "FILLED", "CLOSED"][index],
        ]);
      }
      const sql = readFileSync("prisma/migrations/20260713110000_parent_requests/migration.sql", "utf8");
      await client.query(sql);

      const result = await client.query(`SELECT "id","budgetMin","budgetMax","status","publishedAt","closedAt" FROM "TutoringRequest" ORDER BY "id"`);
      const byId = new Map(result.rows.map((row) => [row.id, row]));
      expect(result.rowCount).toBe(5);
      expect(byId.get(rows[0])).toMatchObject({ budgetMin: null, budgetMax: null, status: "DRAFT", publishedAt: null, closedAt: null });
      expect(byId.get(rows[1])).toMatchObject({ budgetMin: 8888, budgetMax: 19999, status: "PUBLISHED", closedAt: null });
      expect(byId.get(rows[1]).publishedAt).toBeInstanceOf(Date);
      expect(byId.get(rows[2])).toMatchObject({ status: "DRAFT", publishedAt: null, closedAt: null });
      expect(byId.get(rows[3])).toMatchObject({ status: "CLOSED", publishedAt: null });
      expect(byId.get(rows[3]).closedAt).toBeInstanceOf(Date);
      expect(byId.get(rows[4])).toMatchObject({ status: "CLOSED", publishedAt: null });
      expect(byId.get(rows[4]).closedAt).toBeInstanceOf(Date);

      await expect(client.query(`UPDATE "TutoringRequest" SET "budgetMin" = 100001 WHERE "id" = $1`, [rows[0]])).rejects.toMatchObject({ code: "23514" });
      await expect(client.query(`UPDATE "TutoringRequest" SET "status" = 'PUBLISHED', "publishedAt" = NULL WHERE "id" = $1`, [rows[0]])).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release();
    }
  });
});
