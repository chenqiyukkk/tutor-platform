# Chat Review Follow-up Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate stale deep conversation cursors and the migration 13800 table-lock/advisory-lock deadlock while preserving commit-ordered message changes.

**Architecture:** Treat every explicit load-more after page 2 as a cursor-chain rebuild from the latest first-page cursor; polling only marks/updates first-page state and never auto-fetches deep pages. Keep migration 13800 atomic, but backfill versions directly before installing the pair-locking trigger so a transaction holding `Message` AccessExclusive never waits on an application pair lock.

**Tech Stack:** React 19, Vitest/Testing Library, PostgreSQL `pg`, Prisma 7 migrations, TypeScript.

---

### Task 1: Reproduce stale page-2 membership with an unchanged first-page boundary

**Files:**
- Modify: `src/components/chat/chat-workspace.test.tsx`
- Modify after RED: `src/components/chat/chat-workspace.tsx`

**Step 1: Write the failing component test**

Add a test where initial page 1 returns `c1`, old page 2 returns `c2`, and a poll returns the identical page 1 and identical `c1`. On the next load-more click, require requests `c1` then the refreshed page-2 continuation, require the new rank-150 conversation to render, and forbid a direct request to stale `c2`.

**Step 2: Run the test and verify RED**

Run: `npm test -- src/components/chat/chat-workspace.test.tsx`

Expected: FAIL because the current implementation requests stale `c2` directly when the first-page boundary did not change.

**Step 3: Implement the minimal pagination rule**

When more than one page is already loaded, every explicit load-more action starts at `conversationFirstPageCursor` and walks through `targetPageCount - 1` pages. Keep generation/revision/AbortController checks; do not fetch deep pages from the polling callback.

**Step 4: Run the component suite and verify GREEN**

Run: `npm test -- src/components/chat/chat-workspace.test.tsx`

Expected: all component tests pass, including the existing changed-boundary case.

### Task 2: Reproduce and remove the migration lock cycle

**Files:**
- Modify: `src/features/greetings/migration-upgrade.integration.test.ts`
- Modify: `prisma/schema.test.ts`
- Modify after RED: `prisma/migrations/20260713133800_chat_message_change_version/migration.sql`

**Step 1: Write the real PostgreSQL deadlock test**

Deploy through migration 137 in an isolated database and seed a valid legacy message. Begin an application transaction, acquire the canonical account-pair advisory lock, then run the real 13800 SQL with a short test-only `pg_sleep` inserted immediately after `ADD COLUMN` to hold the deterministic AEX window. Observe the migrator's granted `AccessExclusiveLock`, start an application message insert, and require migration plus insert to finish without `40P01`/timeout. Commit and assert the inserted message version is greater than the backfilled legacy version.

**Step 2: Add the migration-order contract and verify RED**

Require the direct `UPDATE ... nextval` backfill to appear before `CREATE TRIGGER`, and require no trigger-fired backfill. Run:

`npm test -- prisma/schema.test.ts src/features/greetings/migration-upgrade.integration.test.ts`

Expected: the current migration fails the order assertion and the concurrent PostgreSQL test with the AEX/pair lock cycle.

**Step 3: Implement the atomic migration ordering**

Within the existing transaction: create the sequence, add nullable `changeVersion`, directly backfill NULL rows with `nextval`, set NOT NULL/default, create the replacement index/drop the old index, then create the function and trigger last. Do not take a pair lock during backfill and do not edit migration 137.

**Step 4: Verify migration GREEN**

Run the schema, migration-upgrade, chat PostgreSQL integration, Prisma validate/status/diff suites. Expected: no deadlock, all 17 migrations deploy, raw inserts/updates still receive trigger versions, and schema diff is empty.

### Task 3: Final gates and focused commit

**Files:** all files changed above plus this plan.

**Step 1:** Run focused suites and `npm test`.

**Step 2:** Run `npm run typecheck`, `npm run lint`, `npm run build`, `npx prisma validate`, `npx prisma migrate status`, and `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`.

**Step 3:** Run `git diff --check`, confirm migration 137 is unchanged, inspect worktree scope, and create one focused local commit without push.
