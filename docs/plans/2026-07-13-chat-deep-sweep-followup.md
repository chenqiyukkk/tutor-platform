# Chat Deep Reconciliation Sweep Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close conversation-list gaps caused by a rank change between sequential page requests without reloading every opened page on every poll.

**Architecture:** Keep the existing first-page visible poll and add an independent deep-reconciliation cursor/depth that fetches at most one user-opened deep page per successful poll. Reset the sweep at realm initialization, first-page boundary changes, and successful manual rebuilds; guard every response with the poll abort signal plus conversation generation/revision so stale work cannot merge or advance cursor state.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Next.js 16.

---

### Task 1: Reproduce the cross-request cursor gap

**Files:**
- Modify: `src/components/chat/chat-workspace.test.tsx`

**Step 1: Write the exact failing test**

Load the first 200 conversations, begin the existing three-page rebuild, return page 2 without rank 250, move rank 250 to rank 150 before page 3 is requested, then return a 49-item terminal page 3. Assert that the rebuild finishes with no load-more button and the moved conversation absent, advance one visible poll, and require the moved conversation to appear automatically.

**Step 2: Run the test and verify RED**

Run: `npm test -- src/components/chat/chat-workspace.test.tsx -t "reconciles a conversation that moves between sequential rebuild requests"`

Expected: FAIL because the visible conversation poll only requests/merges page 1.

### Task 2: Add one-page bounded deep reconciliation

**Files:**
- Modify: `src/components/chat/chat-workspace.tsx`
- Modify: `src/components/chat/chat-workspace.test.tsx`

**Step 1: Implement the minimal sweep state**

Track an independent deep cursor and traversed page depth. After each successful first-page visible poll, fetch at most one continuation when `loadedPageCount > 1`; merge only after checking `signal.aborted`, realm generation, and pagination revision. When the sweep reaches the loaded depth or a null cursor, restart it from the latest first-page cursor for the next poll.

**Step 2: Reset at authoritative pagination transitions**

Reset cursor/depth after initial realm load, a changed first-page boundary, and a successful manual load/rebuild. Increment the pagination revision on successful manual pagination so an overlapping sweep response cannot overwrite the reset. Never assign the manual `conversationNextCursor` from sweep results.

**Step 3: Verify the exact test GREEN**

Run the same focused command and require PASS.

**Step 4: Add a loaded-depth bound test and verify it**

Load exactly three pages whose third page advertises a fourth-page cursor, advance multiple polls, and assert the sweep rotates only through pages 2 and 3 without requesting page 4.

**Step 5: Add stale boundary/realm/abort response tests and verify them**

Hold a deep sweep response, then separately invalidate it with a first-page boundary reset, a realm change, and a visibility abort. Resolve the stale response and assert it neither merges stale items nor advances the next sweep away from the reset cursor.

### Task 3: Documentation and final verification

**Files:**
- Modify: `docs/plans/2026-07-13-chat-design.md`
- Modify: `docs/plans/2026-07-13-chat-change-version-plan.md`

**Step 1: Document the request bound and reset rules**

Record that each visible poll performs one first-page request plus at most one already-opened deep-page request, and that the sweep is independent from manual pagination.

**Step 2: Run focused and full gates**

Run the component suite, one fresh `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, Prisma validate/status/diff, and `git diff --check`.

**Step 3: Review and commit**

Confirm only the component, tests, and plan/design documentation changed; create one focused local commit and do not push.
