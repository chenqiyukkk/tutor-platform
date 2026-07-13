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

**Files:** create `src/components/chat/conversation-list.tsx`, `message-thread.tsx`, `message-composer.tsx`, `chat-workspace.tsx` and tests; create teacher/parent messages pages; modify portal navigation and `src/app/globals.css`.

1. Write failing fake-timer visibility/backoff, AbortController generation, optimistic reconcile/retry, accessibility and mobile navigation tests.
2. Confirm RED.
3. Implement the components/pages and restrained bulletin-board CSS.
4. Run UI tests to GREEN.

### Task 5: Verification

1. Run all affected tests plus migration upgrade tests.
2. Run Prisma validate/status/diff, typecheck, lint, build and `git diff --check`.
3. Review DTOs, lock ordering, cursor ties and responsive/a11y behavior.
4. Commit in one or a few focused commits.

## 实际 RED→GREEN 记录

以下记录来自 2026-07-13 本任务的实际命令输出，不是事后补写的预期结果。

### 缺模块阶段

- RED：初次运行 `vitest run src/features/chat/service.test.ts src/features/chat/service.integration.test.ts` 时，Vite 报告无法解析 `./service`；初次运行 `.\node_modules\.bin\vitest.cmd run src/components/chat/chat-workspace.test.tsx` 时，报告无法解析 `./chat-workspace`，测试文件均为 0 tests。
- GREEN：实现服务后，两份 service 测试曾得到 2 files / 10 tests passed；实现工作台后，UI 测试得到 1 file / 5 tests passed。后续 spec review 又继续增加了下列回归测试。

### 空历史 polling watermark

- RED：`.\node_modules\.bin\vitest.cmd run src/features/chat/service.test.ts -t "captures an empty-history" --reporter=verbose`，调用顺序实际为 `["findMany", "now"]`，与期望的 `["now", "findMany"]` 相反。
- RED：`.\node_modules\.bin\vitest.cmd run src/features/chat/service.integration.test.ts -t "does not lose a message" --reporter=verbose`，真实 PostgreSQL 查询返回后插入的消息没有出现在后续 `after` 结果中。
- GREEN：`.\node_modules\.bin\vitest.cmd run src/features/chat/service.test.ts src/features/chat/service.integration.test.ts -t "captures an empty-history|does not lose a message" --reporter=verbose`，2 tests passed。

### block 后幂等重放

- RED：`.\node_modules\.bin\vitest.cmd run src/features/chat/service.integration.test.ts -t "replays an exact committed message after block" --reporter=verbose`，同一 `clientMessageId` 的精确重放错误地抛出 `ChatWorkflowError: 双方当前不能互相发送消息`（`BLOCKED`）。
- GREEN：`.\node_modules\.bin\vitest.cmd run src/features/chat/service.integration.test.ts -t "replays an exact committed message after block|serializes send behind" --reporter=verbose`，幂等重放与既有 block/send 竞态共 2 tests passed。

### 会话列表 cursor 分页

- RED：`.\node_modules\.bin\vitest.cmd run src/components/chat/chat-workspace.test.tsx -t "loads and de-duplicates|aborts and ignores a stale conversation page" --reporter=verbose`，两项测试都因找不到名为“加载更多会话”的 button 失败。
- GREEN：使用同一命令复跑，101 个唯一会话、跨页去重以及 realm 切换时 abort/generation 隔离共 2 tests passed。
- RED→GREEN（收紧去重）：第二页同时返回两个相同的新 ID 后，`-t "loads and de-duplicates"` 先因找到两个“第101位家长”按钮并报告重复 React key 而失败；逐项把新 ID 加入 Set 后，同一命令 1 test passed。

### polling 退避

- RED：`.\node_modules\.bin\vitest.cmd run src/components/chat/chat-workspace.test.tsx -t "backs failed polls off" --reporter=verbose`，第二个精确时间点期望 2 次调用、实际只有 1 次，证明第一次失败后等待了 4 秒。
- GREEN：`.\node_modules\.bin\vitest.cmd run src/components/chat/chat-workspace.test.tsx -t "polls only while visible|backs failed polls off" --reporter=verbose`，可见性恢复与 2/4/8/16/30/30 秒退避、成功后复位 2 秒共 2 tests passed。
