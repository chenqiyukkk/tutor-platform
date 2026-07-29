# Parent Requests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为家长提供隐私安全的学生档案与家教需求草稿、发布、编辑回草稿和关闭工作流。

**Architecture:** 使用 Zod 定义严格输入边界，领域 service 负责状态机与字段错误，Prisma repository 负责所有权、事务替换关联以及发布锁。API handlers 只接受家长 session，并输出移除 account/profile 内部标识的 DTO；App Router 页面以 Server Component 取数，Client Form 承担交互与 stale-response 防护。

**Tech Stack:** Next.js App Router、React 19、TypeScript、Zod 4、Prisma 7、PostgreSQL、Vitest、Testing Library。

---

### Task 1: 数据模型与迁移

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260713110000_parent_requests/migration.sql`

1. 先写真实 PostgreSQL 集成测试，覆盖 legacy 数据兼容、金额边界和状态时间 CHECK，并运行确认 RED。
2. 新增 `TeachingMode`、请求公开位置、说明、关闭时间字段；将金额统一为 cents 整数；添加金额与状态时间 CHECK。
3. 生成 Prisma Client，执行迁移并运行集成测试确认 GREEN。

### Task 2: 学生与需求领域服务

**Files:**
- Create: `src/features/requests/schema.ts`
- Create: `src/features/requests/service.ts`
- Create: `src/features/requests/service.test.ts`

1. 先写 create/edit/publish/close、非法字段、A/B 所有权、published 编辑回 draft、closed 不可逆和 fieldErrors 的失败测试。
2. 运行目标测试，确认因领域实现缺失而 RED。
3. 实现严格 schema、DTO、错误类型、完成度校验和服务方法。
4. 运行目标测试确认 GREEN。

### Task 3: Prisma repository 与真实数据库原子性

**Files:**
- Create: `src/features/requests/repository.ts`
- Create: `src/features/requests/repository.integration.test.ts`
- Create: `src/features/requests/server.ts`

1. 先写 A/B 学生与请求、draft→publish→edit→republish→close、停用资源、跨所有权和失败不部分写的集成测试并确认 RED。
2. 实现事务保存和发布锁顺序：request → sorted subjects → region → student/parent；稳定重读所有权和 active 状态。
3. 运行真实 PostgreSQL 集成测试确认 GREEN。

### Task 4: 家长 API

**Files:**
- Create: `src/features/requests/route-handler.ts`
- Create: `src/features/requests/route-handler.test.ts`
- Create: `src/app/api/parent/students/route.ts`
- Create: `src/app/api/parent/students/[id]/route.ts`
- Create: `src/app/api/parent/requests/route.ts`
- Create: `src/app/api/parent/requests/[id]/route.ts`

1. 先写 role guard、DTO 脱敏、禁止 PATCH、字段错误及 401/404/409 映射测试并确认 RED。
2. 实现 handlers 与 route adapters，POST action 仅允许 publish/close。
3. 运行目标测试确认 GREEN。

### Task 5: 家长 Portal 与组件

**Files:**
- Create: `src/features/requests/auth.ts`
- Create: `src/components/requests/request-form.tsx`
- Create: `src/components/requests/request-form.test.tsx`
- Create: `src/components/requests/request-card.tsx`
- Create: `src/components/requests/request-card.test.tsx`
- Create: `src/components/parents/student-manager.tsx`
- Create: `src/app/(portal)/parent/layout.tsx`
- Modify: `src/app/(portal)/parent/dashboard/page.tsx`
- Create: `src/app/(portal)/parent/students/page.tsx`
- Create: `src/app/(portal)/parent/requests/new/page.tsx`
- Create: `src/app/(portal)/parent/requests/[id]/edit/page.tsx`
- Modify: `src/app/globals.css`

1. 先写表单 stale/busy、发布前错误、RequestCard 脱敏与空科目提示测试并确认 RED。
2. 实现响应式、键盘可用的家长工作台、学生管理、需求编辑、预览、发布和关闭 UI。
3. 运行组件测试确认 GREEN。

### Task 6: 完整验证与提交

1. 执行 `npx prisma validate`、`npx prisma migrate status`、真实 PostgreSQL 集成测试、`npm test`、`npm run typecheck`、`npm run lint`、`npm run build`。
2. 检查 `git diff --check` 与最终 diff，确保没有公开真实姓名、手机号、精确学校/地址字段，也未提前实现 Task9/10。
3. 提交 `feat: add tutoring requests`。
