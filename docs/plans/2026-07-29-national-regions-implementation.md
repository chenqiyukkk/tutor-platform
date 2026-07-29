# 全国省市区县数据 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将演示用的少量地区替换为全国省—市—区县三级数据，让家长和老师可按实际区县发布并在同地区匹配。

**Architecture:** 固定 `@province-city-china/level` 的精确版本，在种库阶段将其层级数据转换为现有 `Region` 模型。直辖市和港澳补一个仅用于三级选择的城市层，过滤“市辖区”等不可作为真实授课地点的占位项；API、表单和匹配查询继续使用现有区域 UUID，无需改数据库结构。

**Tech Stack:** TypeScript、Prisma、PostgreSQL、Vitest、Next.js

---

### Task 1: 固定数据源并定义转换规则

**Files:**
- Create: `prisma/region-data.ts`
- Test: `prisma/region-data.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

1. 先写失败测试，校验省市区县总量、代码唯一性、父子层级和广州 11 个区。
2. 运行测试并确认因转换模块缺失而失败。
3. 精确安装行政区划数据包，编写纯函数转换器。
4. 再次运行测试并确认通过。

### Task 2: 将完整数据接入 Prisma 种库

**Files:**
- Modify: `prisma/seed.ts`
- Test: `prisma/region-data.test.ts`

1. 用转换后的完整列表替换地区演示数据。
2. 按省、市、区县顺序幂等 upsert，并将快照外的旧区域标记为停用而非删除。
3. 保留可验证的相邻区关系，避免破坏已有匹配规则。
4. 运行单元测试、类型检查与 lint。

### Task 3: 数据库和页面验收

**Files:**
- Modify: `README.md`

1. 对本地 PostgreSQL 执行种库。
2. 检查地区总数、广州区县数，并调用区域 API 验证三级联动。
3. 补充数据来源、快照版本和更新说明。
4. 运行完整测试与生产构建。
5. 提交并推送到公开 GitHub 分支。
