// @vitest-environment node

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { Client } from "pg";
import { expect, it } from "vitest";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for seed upgrade tests");

const prismaCli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");

function runPrisma(args: string[], databaseUrl: string) {
  execFileSync(process.execPath, [prismaCli, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
}

it("upgrades the legacy two-level Beijing and Shanghai seed without deleting data", async () => {
  const sourceUrl = new URL(process.env.DATABASE_URL!);
  const databaseName = `tutor_seed_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  const temporaryUrl = new URL(sourceUrl);
  temporaryUrl.pathname = `/${databaseName}`;
  const admin = new Client({ connectionString: adminUrl.toString() });
  let prisma: PrismaClient | undefined;

  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  try {
    runPrisma(["migrate", "deploy"], temporaryUrl.toString());
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: temporaryUrl.toString() }),
    });

    const beijing = await prisma.region.create({
      data: { code: "110000", name: "北京市", level: 1, sortOrder: 10 },
    });
    const shanghai = await prisma.region.create({
      data: { code: "310000", name: "上海市", level: 1, sortOrder: 20 },
    });
    await prisma.region.createMany({ data: [
      { code: "110105", name: "朝阳区", level: 2, parentId: beijing.id, sortOrder: 10 },
      { code: "110108", name: "海淀区", level: 2, parentId: beijing.id, sortOrder: 20 },
      { code: "310101", name: "黄浦区", level: 2, parentId: shanghai.id, sortOrder: 10 },
      { code: "310115", name: "浦东新区", level: 2, parentId: shanghai.id, sortOrder: 20 },
    ] });

    runPrisma(["db", "seed"], temporaryUrl.toString());
    runPrisma(["db", "seed"], temporaryUrl.toString());

    const upgraded = await prisma.region.findMany({
      where: { code: { in: [
        "110000", "110100", "110105", "110108",
        "310000", "310100", "310101", "310115",
      ] } },
      select: { code: true, level: true, parent: { select: { code: true } } },
      orderBy: { code: "asc" },
    });
    expect(upgraded).toEqual([
      { code: "110000", level: 1, parent: null },
      { code: "110100", level: 2, parent: { code: "110000" } },
      { code: "110105", level: 3, parent: { code: "110100" } },
      { code: "110108", level: 3, parent: { code: "110100" } },
      { code: "310000", level: 1, parent: null },
      { code: "310100", level: 2, parent: { code: "310000" } },
      { code: "310101", level: 3, parent: { code: "310100" } },
      { code: "310115", level: 3, parent: { code: "310100" } },
    ]);
    expect(await prisma.subject.count()).toBe(6);
    expect(await prisma.region.count()).toBe(15);
    expect(await prisma.regionAdjacency.count()).toBe(4);
  } finally {
    await prisma?.$disconnect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
}, 120_000);
