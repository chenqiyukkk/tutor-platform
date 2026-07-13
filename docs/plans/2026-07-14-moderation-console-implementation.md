# Moderation Console Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a privacy-safe moderation workflow for reports, blocks, voluntary teacher verification, admin decisions, content takedown, account suspension, and immutable audit history.

**Architecture:** Add one forward-only PostgreSQL migration, then layer server-only domain services and strict route handlers over it. Public callers submit contextual target locators; services derive account IDs and safe evidence. Admin pages call the same services used by mutation APIs, while verification evidence stays behind a storage adapter and an ACTIVE ADMIN download gate.

**Tech Stack:** Next.js App Router, TypeScript, React, Zod, Prisma 7, PostgreSQL advisory/row locks, Vitest, Testing Library, `sharp` for server-side image decode/re-encode.

---

## Execution discipline

- Use @test-driven-development for every behavior change.
- Use @frontend-design for admin and verification pages.
- Use @subagent-driven-development: implementer → spec review → quality review for each phase.
- Use @verification-before-completion before each commit and push.
- Never modify migrations already pushed to GitHub.
- Preserve the global lock order documented in `src/features/interactions/account-pair-lock.ts` and the Task 11 chat plans.

### Task 1: Add moderation database invariants

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260714090000_moderation_workflow/migration.sql`
- Modify: `prisma/schema.test.ts`
- Modify: `src/features/greetings/migration-upgrade.integration.test.ts`
- Create: `src/features/moderation/migration.integration.test.ts`

**Step 1: Write failing schema and upgrade tests**

Assert the schema exposes report target metadata, request IDs, moderation holds and audit request IDs. Add real PostgreSQL tests for:

```ts
await expect(twoOpenReportsForSameReporterTarget()).rejects.toMatchObject({ code: "23505" });
await expect(twoPendingVerificationsForSameType()).rejects.toMatchObject({ code: "23505" });
await expect(updateAuditRow()).rejects.toMatchObject({ code: "55000" });
```

Also seed an existing greeting report before applying the new migration and assert it becomes `targetType='GREETING'` with a canonical target ID.

**Step 2: Run RED tests**

Run:

```powershell
npm test -- prisma/schema.test.ts src/features/moderation/migration.integration.test.ts src/features/greetings/migration-upgrade.integration.test.ts
```

Expected: FAIL because the fields, indexes and triggers do not exist.

**Step 3: Implement the forward migration and Prisma model changes**

Add `ReportTargetType` and `ReportResolutionAction`; add the fields described in the design. Backfill existing rows before setting target columns NOT NULL. Add partial unique indexes with raw SQL and an append-only audit trigger. Add moderation hold fields without changing pushed migrations.

**Step 4: Verify GREEN and database parity**

Run the focused tests, then:

```powershell
npx prisma validate
npx prisma migrate status
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Expected: all pass; 18 migrations; no difference detected.

**Step 5: Commit**

```powershell
git add prisma src/features/moderation src/features/greetings/migration-upgrade.integration.test.ts
git commit -m "feat: add moderation data invariants"
```

### Task 2: Implement contextual report and block services

**Files:**

- Create: `src/features/moderation/schema.ts`
- Create: `src/features/moderation/data.ts`
- Create: `src/features/moderation/service.ts`
- Create: `src/features/moderation/service.test.ts`
- Create: `src/features/moderation/service.integration.test.ts`
- Create: `src/features/moderation/route-handler.ts`
- Create: `src/features/moderation/route-handler.test.ts`
- Create: `src/features/moderation/server.ts`
- Create: `src/app/api/reports/route.ts`
- Create: `src/app/api/blocks/route.ts`
- Modify: `src/features/greetings/service.ts`
- Modify: `src/features/greetings/service.integration.test.ts`

**Step 1: Write failing service tests**

Use a strict discriminated union:

```ts
const moderationTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("teacher_profile"), profileId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("tutoring_request"), requestId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("greeting"), greetingId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("conversation"), conversationId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("message"), messageId: z.string().uuid() }).strict(),
]);
```

Cover every target, self-report, inaccessible targets, inactive/wrong-role actors, forbidden client account IDs, safe snapshots, `clientRequestId` replay/conflict, open-report deduplication and the fact that report does not create Block.

For Block, prove the service derives the counterpart, acquires the canonical pair lock, rejects self/admin targets, upserts idempotently, and blocks both greeting and chat sends.

**Step 2: Run RED tests**

```powershell
npm test -- src/features/moderation/service.test.ts src/features/moderation/service.integration.test.ts src/features/moderation/route-handler.test.ts
```

Expected: FAIL because moderation modules and routes do not exist.

**Step 3: Implement the smallest safe service**

- Authenticate from the realm cookie with duplicate-cookie rejection.
- Derive account and relation fields inside the service.
- Return generic NOT_FOUND for missing or inaccessible resources.
- Build snapshots only from fields already visible to that actor.
- Use `readLimitedJson` and return no account IDs.
- Update the existing pending greeting-report transaction to populate canonical target fields.

**Step 4: Run focused and interaction regression tests**

```powershell
npm test -- src/features/moderation src/features/greetings src/features/chat
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/features/moderation src/app/api/reports src/app/api/blocks src/features/greetings
git commit -m "feat: add contextual reports and blocks"
```

### Task 3: Implement private teacher verification submission

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Modify: `.env.example`
- Create: `src/features/verifications/schema.ts`
- Create: `src/features/verifications/storage.ts`
- Create: `src/features/verifications/storage.test.ts`
- Create: `src/features/verifications/service.ts`
- Create: `src/features/verifications/service.test.ts`
- Create: `src/features/verifications/service.integration.test.ts`
- Create: `src/features/verifications/route-handler.ts`
- Create: `src/features/verifications/route-handler.test.ts`
- Create: `src/features/verifications/server.ts`
- Create: `src/app/api/teacher/verifications/route.ts`

**Step 1: Add `sharp` and write failing storage tests**

Test JPEG/PNG allowlist, 5 MiB limit, wrong magic bytes, pixel limit, EXIF removal, random key generation, path containment, production local-storage rejection and cleanup after repository failure.

**Step 2: Write failing verification service tests**

Cover ACTIVE teacher ownership, required TeacherProfile, allowed types, one pending submission per type, client request replay/conflict, safe DTOs, rejected resubmission and disabled production state.

**Step 3: Run RED tests**

```powershell
npm test -- src/features/verifications
```

Expected: FAIL because the feature does not exist.

**Step 4: Implement storage and service**

Re-encode uploads server-side and store only:

```ts
type PrivateEvidence = {
  provider: "local-private";
  key: string;
  mimeType: "image/jpeg" | "image/png";
  byteSize: number;
  sha256: string;
};
```

Never return `key` from public/teacher DTOs. Refuse local storage when `NODE_ENV === "production"`.

**Step 5: Verify and commit**

Run focused tests, typecheck, lint, then:

```powershell
git add package.json package-lock.json .gitignore .env.example src/features/verifications src/app/api/teacher/verifications
git commit -m "feat: add private teacher verification submissions"
```

### Task 4: Implement admin moderation transactions

**Files:**

- Create: `src/features/moderation/admin-schema.ts`
- Create: `src/features/moderation/admin-service.ts`
- Create: `src/features/moderation/admin-service.test.ts`
- Create: `src/features/moderation/admin-service.integration.test.ts`
- Create: `src/features/moderation/admin-route-handler.ts`
- Create: `src/features/moderation/admin-route-handler.test.ts`
- Create: `src/features/moderation/admin-server.ts`
- Create: `src/app/api/admin/reports/[id]/route.ts`
- Create: `src/app/api/admin/users/[id]/route.ts`
- Create: `src/app/api/admin/verifications/[id]/route.ts`
- Create: `src/app/api/admin/verifications/[id]/evidence/route.ts`
- Modify: `src/features/chat/service.ts`
- Modify: `src/features/greetings/service.ts`
- Modify: `src/features/teachers/repository.ts`
- Modify: `src/features/teachers/service.ts`
- Modify: `src/features/requests/repository.ts`
- Modify: `src/features/requests/service.ts`

**Step 1: Write failing admin transaction tests**

Cover:

- ACTIVE ADMIN only; teacher/parent and suspended admin rejected.
- optimistic `expectedUpdatedAt` conflicts.
- one winner for concurrent report/verification decisions.
- exact `clientRequestId` replay and conflicting reuse.
- account suspension revokes sessions and hides public content atomically.
- content takedown creates moderation hold.
- held content cannot publish until its owner saves an edit.
- message takedown follows pair-lock order, sets `deletedAt/updatedAt`, and appears in chat change polling.
- every mutation writes exactly one sanitized audit row.
- audit update/delete rejected by PostgreSQL.

**Step 2: Run RED tests**

```powershell
npm test -- src/features/moderation/admin-service.test.ts src/features/moderation/admin-service.integration.test.ts
```

Expected: FAIL.

**Step 3: Implement transaction helpers and routes**

Use preliminary immutable locators only to choose lock order. For message actions: pair advisory lock first, then Report and Message rows. For replay, load `AdminAuditLog.requestId`, validate action/target/admin, and return the current safe DTO without repeating side effects.

Evidence download must re-authenticate ACTIVE ADMIN, validate evidence metadata, stream only from the private adapter and use:

```ts
{
  "Cache-Control": "private, no-store",
  "Content-Disposition": "attachment; filename=verification-evidence.jpg",
  "X-Content-Type-Options": "nosniff",
}
```

**Step 4: Run cross-feature regression tests**

```powershell
npm test -- src/features/moderation src/features/verifications src/features/auth src/features/greetings src/features/chat src/features/teachers src/features/requests
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/features src/app/api/admin
git commit -m "feat: add audited admin moderation actions"
```

### Task 5: Build teacher verification and public safety entry points

**Files:**

- Modify: `src/app/(portal)/teacher/layout.tsx`
- Create: `src/app/(portal)/teacher/verification/page.tsx`
- Create: `src/components/verifications/verification-form.tsx`
- Create: `src/components/verifications/verification-form.test.tsx`
- Create: `src/components/moderation/safety-action-dialog.tsx`
- Create: `src/components/moderation/safety-action-dialog.test.tsx`
- Modify: `src/app/(public)/teachers/[id]/page.tsx`
- Modify: `src/app/(public)/requests/[id]/page.tsx`
- Modify: `src/components/chat/message-thread.tsx`
- Modify: `src/components/chat/chat-workspace.tsx`
- Modify: `src/components/greetings/greeting-card.tsx`
- Modify: `src/components/greetings/greeting-inbox.tsx`
- Modify: `src/app/globals.css`

**Step 1: Write failing component tests**

Prove voluntary copy, disabled production upload, no object key/path in DOM, explicit file submit, report-vs-block independence, counterpart-only message report, native dialog focus/cancel/error/retry and safe result announcements.

**Step 2: Run RED tests**

```powershell
npm test -- src/components/verifications src/components/moderation src/components/chat src/components/greetings
```

Expected: FAIL.

**Step 3: Implement UI without exposing account IDs**

Use target locators only. Directory actions appear on detail pages, not crowded list cards. Chat report is available for counterpart messages; conversation block remains in the header. Existing pending greeting actions retain their atomic workflow; historical safety actions use the generic service without destroying an accepted greeting.

**Step 4: Verify responsive and accessibility behavior**

Run component tests, typecheck and lint. Inspect 375/768/1024/1440 px using synthetic data only.

**Step 5: Commit**

```powershell
git add src/app src/components src/app/globals.css
git commit -m "feat: add verification and safety workflows"
```

### Task 6: Build the dense admin console

**Files:**

- Create: `src/app/(portal)/admin/layout.tsx`
- Modify: `src/app/(portal)/admin/dashboard/page.tsx`
- Create: `src/app/(portal)/admin/users/page.tsx`
- Create: `src/app/(portal)/admin/reports/page.tsx`
- Create: `src/app/(portal)/admin/verifications/page.tsx`
- Create: `src/app/(portal)/admin/loading.tsx`
- Create: `src/app/(portal)/admin/error.tsx`
- Create: `src/components/admin/admin-action-dialog.tsx`
- Create: `src/components/admin/admin-action-dialog.test.tsx`
- Create: `src/components/admin/moderation-table.tsx`
- Create: `src/components/admin/moderation-table.test.tsx`
- Create: `src/components/admin/audit-timeline.tsx`
- Create: `src/components/admin/audit-timeline.test.tsx`
- Modify: `src/app/globals.css`

**Step 1: Write failing page/component tests**

Cover ADMIN guard, URL filters, table caption/headers, mobile card parity, no default email/evidence exposure, empty/loading/error states, dialog focus lifecycle, 409 refresh, row removal focus and aria-live result.

**Step 2: Run RED tests**

```powershell
npm test -- src/components/admin 'src/app/(portal)/admin'
```

Expected: FAIL.

**Step 3: Implement server pages and client mutations**

Server pages call admin list services directly; do not create redundant internal GET APIs. Add `export const dynamic = "force-dynamic"` and no-store behavior for sensitive pages. Render only allowlisted audit metadata.

**Step 4: Verify responsive/a11y behavior and commit**

```powershell
npm test -- src/components/admin 'src/app/(portal)/admin'
npm run typecheck
npm run lint
git add 'src/app/(portal)/admin' src/components/admin src/app/globals.css
git commit -m "feat: add moderation console"
```

### Task 7: Add secure admin bootstrap and operating notes

**Files:**

- Create: `scripts/create-admin.ts`
- Create: `scripts/create-admin.test.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `docs/deployment.md`
- Create: `docs/operations/moderation.md`

**Step 1: Write failing bootstrap tests**

Require username/email/password through environment or explicit CLI options; never create default credentials; reject an existing admin rather than silently changing its password; hash with the existing auth password helper.

**Step 2: Implement and document**

Document admin bootstrap, evidence-storage production gate, content/report/verification runbooks, audit evidence, safe rollback and synthetic-data-only testing.

**Step 3: Verify and commit**

```powershell
npm test -- scripts/create-admin.test.ts
git add scripts package.json .env.example docs
git commit -m "docs: add moderation operations"
```

### Task 8: Final Task 12 verification and GitHub sync

**Files:**

- Modify only if a gate reveals a real defect.

**Step 1: Run focused and full gates**

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npx prisma validate
npx prisma migrate status
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
git diff --check
```

Expected: all pass, worktree clean after commits.

**Step 2: Independent reviews**

Run a full spec review against `2026-07-14-moderation-console-design.md`, then a separate quality/security review. Fix every Critical/Important finding and any reproducible omission before push.

**Step 3: Push**

```powershell
git push origin codex/development
```

Expected: the public GitHub branch and draft PR contain every Task 12 commit.
