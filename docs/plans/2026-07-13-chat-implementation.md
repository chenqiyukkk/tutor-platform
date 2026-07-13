# Chat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为已接受打招呼的老师与家长提供安全、幂等、可分页和可轮询的站内消息。

**Architecture:** Prisma/PostgreSQL 服务层负责全部授权、不变量、锁和 keyset 查询；Next route handlers 负责 realm cookie 与严格输入边界；React client workspace 负责可见性轮询和 optimistic reconcile。

**Tech Stack:** Next.js App Router、React 19、Prisma 7、PostgreSQL、Zod、Vitest、Testing Library。

---

### Task 1: Shared pair lock and chat schemas

**Files:** create `src/features/interactions/account-pair-lock.ts`, `src/features/interactions/account-pair-lock.test.ts`, `src/features/chat/schema.ts`, `src/features/chat/schema.test.ts`; modify `src/features/greetings/service.ts`.

1. Write failing canonical-lock, UUID, code-point, strict query and cursor tests.
2. Run the two test files and confirm missing-module/behavior failures.
3. Implement the minimal shared lock and schemas; make GreetingService import the shared lock.
4. Run the tests and greeting service tests to GREEN.

### Task 2: Chat service and PostgreSQL behavior

**Files:** create `src/features/chat/service.ts`, `src/features/chat/service.test.ts`, `src/features/chat/service.integration.test.ts`.

1. Write failing service tests for actor/membership/context validation, block checks, DTO redaction, idempotency, cursors, unread/read semantics and tie timestamps.
2. Run and confirm RED for the absent service.
3. Implement list/history/poll/send/read with transaction-scoped locks and strict DTO mapping.
4. Run unit and integration tests to GREEN.

### Task 3: Routes and migration

**Files:** create `src/features/chat/route-handler.ts`, `src/features/chat/route-handler.test.ts`, `src/features/chat/server.ts`, three API route files, `prisma/migrations/20260713133600_chat_polling_indexes/migration.sql`; modify schema and migration-upgrade tests.

1. Write failing route tests for realm cookies, UUID/query duplication, 400/401/403/404/409/413 responses; write failing migration assertions.
2. Confirm RED.
3. Implement handlers/routes and forward-only indexes, then generate Prisma client.
4. Run route/migration tests to GREEN.

### Task 4: Messaging UI

**Files:** create `src/components/messages/conversation-list.tsx`, `message-thread.tsx`, `message-composer.tsx`, `chat-workspace.tsx` and tests; create teacher/parent messages pages; modify portal navigation and `src/app/globals.css`.

1. Write failing fake-timer visibility/backoff, AbortController generation, optimistic reconcile/retry, accessibility and mobile navigation tests.
2. Confirm RED.
3. Implement the components/pages and restrained bulletin-board CSS.
4. Run UI tests to GREEN.

### Task 5: Verification

1. Run all affected tests plus migration upgrade tests.
2. Run Prisma validate/status/diff, typecheck, lint, build and `git diff --check`.
3. Review DTOs, lock ordering, cursor ties and responsive/a11y behavior.
4. Commit in one or a few focused commits.
