# Tutor Platform Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a production-ready MVP for free, region-based, two-way matching between tutors and parents, including separate portals, controlled greetings, text chat, and a minimal moderation console.

**Architecture:** Use one Next.js App Router application with server-rendered pages and Route Handlers. Keep business rules in framework-independent TypeScript services, persist data in PostgreSQL through Prisma, and use database-backed sessions with strict role guards. Start chat delivery with short polling so the MVP remains a single deployable service.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, PostgreSQL, Prisma ORM, Zod, @node-rs/argon2, Nodemailer, Vitest, Testing Library, Playwright, Docker Compose.

---

## Working agreements

- Work only in D:\家教平台\.worktrees\development on branch codex/development.
- Follow @test-driven-development for every behavior change.
- Run the narrowest failing test first, then the complete relevant suite.
- Use @frontend-design for all user-facing screens.
- Use @verification-before-completion before every commit and before final delivery.
- Use @requesting-code-review after the main user flows are complete.
- Never commit .env files, credentials, uploaded identity documents, or production data.
- Keep teacher, parent, and admin authorization checks on the server.

### Task 1: Bootstrap the Next.js application and quality gates

**Files:**
- Create: package.json
- Create: package-lock.json
- Create: tsconfig.json
- Create: next.config.ts
- Create: postcss.config.mjs
- Create: eslint.config.mjs
- Create: vitest.config.ts
- Create: vitest.setup.ts
- Create: src/app/layout.tsx
- Create: src/app/page.tsx
- Create: src/app/globals.css
- Create: src/app/page.test.tsx
- Modify: .gitignore

**Step 1: Write the failing smoke test**

Create src/app/page.test.tsx:

~~~tsx
import { render, screen } from "@testing-library/react";
import HomePage from "./page";

it("introduces the free two-way tutoring platform", () => {
  render(<HomePage />);
  expect(screen.getByRole("heading", { name: /找到合适的老师，也找到真正需要你的学生/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "我是老师" })).toHaveAttribute("href", "/teacher");
  expect(screen.getByRole("link", { name: "我是家长" })).toHaveAttribute("href", "/parent");
});
~~~

**Step 2: Run the test to verify the harness is absent**

Run: npm test -- src/app/page.test.tsx

Expected: FAIL because package.json and the test runner do not exist.

**Step 3: Install and configure the minimal application**

Run:

~~~powershell
npm init -y
npm install next@latest react@latest react-dom@latest zod
npm install -D typescript @types/node @types/react @types/react-dom eslint eslint-config-next tailwindcss @tailwindcss/postcss vitest jsdom @testing-library/react @testing-library/jest-dom
~~~

Add scripts for dev, build, start, lint, typecheck, test, test:watch, and test:e2e. Configure the App Router, Vitest jsdom environment, Testing Library setup, Tailwind import, and a minimal HomePage that satisfies the test.

**Step 4: Verify the bootstrap**

Run: npm test -- src/app/page.test.tsx

Expected: PASS, 1 test.

Run: npm run typecheck

Expected: exit 0.

Run: npm run lint

Expected: exit 0.

**Step 5: Commit**

~~~powershell
git add package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs vitest.config.ts vitest.setup.ts src .gitignore
git commit -m "chore: bootstrap Next.js application"
~~~

### Task 2: Build the visual system and public shell

**Design direction:** A warm civic noticeboard with editorial restraint: rice-paper cream background, deep ink green, vermilion action accents, fine rule lines, tactile cards, and asymmetric but calm layouts. The memorable element is the “local circle” ribbon that visibly connects nearby tutors and families. Avoid purple gradients, generic dashboard chrome, and excessive rounded cards.

**Files:**
- Create: src/components/brand/logo.tsx
- Create: src/components/layout/public-header.tsx
- Create: src/components/layout/public-footer.tsx
- Create: src/components/ui/button.tsx
- Create: src/components/ui/badge.tsx
- Create: src/components/ui/card.tsx
- Create: src/components/ui/empty-state.tsx
- Create: src/components/ui/form-field.tsx
- Create: src/components/ui/pagination.tsx
- Create: src/components/ui/toast.tsx
- Create: src/app/(public)/layout.tsx
- Move: src/app/page.tsx to src/app/(public)/page.tsx
- Create: src/components/layout/public-header.test.tsx
- Modify: src/app/globals.css

**Step 1: Write failing accessibility tests**

Test keyboard-visible navigation, a single page-level heading, semantic landmarks, and teacher/parent calls to action.

Run: npm test -- src/components/layout/public-header.test.tsx

Expected: FAIL because the shell components do not exist.

**Step 2: Define tokens and components**

Define CSS variables for color, type scale, spacing, radii, borders, shadows, and motion. Use a serif display stack for headings and a highly readable Chinese sans-serif stack for body copy. Implement reduced-motion support and a 44px minimum interactive target.

**Step 3: Implement the public landing page**

Include the value proposition, teacher/parent entry cards, region-circle explanation, zero-information-fee pledge, safety steps, and preview cards for tutors and requests. Keep all preview data explicitly marked as demonstrations until the database task is connected.

**Step 4: Verify responsive behavior**

Run: npm test

Expected: all component tests pass.

Run: npm run typecheck && npm run lint

Expected: exit 0.

**Step 5: Commit**

~~~powershell
git add src
git commit -m "feat: add public design system"
~~~

### Task 3: Add PostgreSQL, Prisma, and the core schema

**Files:**
- Create: compose.yaml
- Create: .env.example
- Create: prisma.config.ts
- Create: prisma/schema.prisma
- Create: prisma/seed.ts
- Create: src/lib/db.ts
- Create: src/lib/env.ts
- Create: src/lib/env.test.ts
- Modify: package.json
- Modify: .gitignore

**Step 1: Write the failing environment test**

Test that invalid or missing DATABASE_URL and SESSION_SECRET values return structured validation errors without exposing secret values.

Run: npm test -- src/lib/env.test.ts

Expected: FAIL because env.ts does not exist.

**Step 2: Install persistence dependencies**

Run:

~~~powershell
npm install @prisma/client @prisma/adapter-pg pg
npm install -D prisma tsx @types/pg
~~~

**Step 3: Add the database model**

Create enums for AccountRole, AccountStatus, ProfileStatus, GreetingStatus, RequestStatus, ReportStatus, and VerificationStatus.

Create models for Account, Session, PasswordResetToken, TeacherProfile, ParentProfile, StudentProfile, Subject, Region, TeacherSubject, TeacherServiceArea, TutoringRequest, RequestSubject, Favorite, Greeting, Conversation, Message, Block, Report, Verification, and AdminAuditLog.

Required constraints:

- Account uses a generated ID and a composite unique key on role plus normalizedUsername.
- Account email is normalized and unique per role.
- TeacherServiceArea has isPrimary and a unique teacher-profile/region pair.
- One teacher profile can have at most five service areas; enforce the count in the service layer.
- Greeting is unique for sender, recipient, and tutoring request.
- Conversation has a unique greeting ID.
- Message supports a unique clientMessageId for idempotency.
- All timestamps use UTC.

**Step 4: Start PostgreSQL and migrate**

Run:

~~~powershell
docker compose up -d db
npx prisma format
npx prisma validate
npx prisma migrate dev --name init
npm run db:seed
~~~

Expected: schema validates, migration succeeds, and subjects plus a small administrative-region fixture are inserted.

**Step 5: Verify and commit**

Run: npm test -- src/lib/env.test.ts

Expected: PASS.

Run: npx prisma validate

Expected: success.

~~~powershell
git add compose.yaml .env.example prisma.config.ts prisma src/lib package.json package-lock.json .gitignore
git commit -m "feat: add core database schema"
~~~

### Task 4: Implement credentials authentication and role isolation

**Files:**
- Create: src/features/auth/schemas.ts
- Create: src/features/auth/password.ts
- Create: src/features/auth/session.ts
- Create: src/features/auth/service.ts
- Create: src/features/auth/guards.ts
- Create: src/features/auth/service.test.ts
- Create: src/app/api/auth/register/route.ts
- Create: src/app/api/auth/login/route.ts
- Create: src/app/api/auth/logout/route.ts
- Create: src/app/teacher/(auth)/login/page.tsx
- Create: src/app/teacher/(auth)/register/page.tsx
- Create: src/app/parent/(auth)/login/page.tsx
- Create: src/app/parent/(auth)/register/page.tsx
- Create: src/app/admin/login/page.tsx
- Create: src/middleware.ts

**Step 1: Write failing auth service tests**

Cover username normalization, duplicate username rejection within a role, the same username allowed across teacher and parent roles, password hashing, invalid credential responses, secure session creation, and role guard rejection.

Run: npm test -- src/features/auth/service.test.ts

Expected: FAIL because the auth service is absent.

**Step 2: Install and implement auth primitives**

Run: npm install @node-rs/argon2

Hash passwords with Argon2id. Generate a random opaque session token, store only its SHA-256 digest, and issue the raw token in an HttpOnly, Secure-in-production, SameSite=Lax cookie. Do not return different login errors for unknown users and wrong passwords.

**Step 3: Add server routes and forms**

Use shared Zod schemas, but force the role from the portal route rather than trusting a client-provided role. Redirect successful logins to the matching portal dashboard.

**Step 4: Verify authorization**

Run: npm test -- src/features/auth/service.test.ts

Expected: PASS.

Add route tests proving teacher sessions cannot access parent or admin handlers.

Run: npm test && npm run typecheck && npm run lint

Expected: all pass.

**Step 5: Commit**

~~~powershell
git add src package.json package-lock.json
git commit -m "feat: add role-isolated authentication"
~~~

### Task 5: Add password recovery by email

**Files:**
- Create: src/features/email/adapter.ts
- Create: src/features/email/console-adapter.ts
- Create: src/features/email/smtp-adapter.ts
- Create: src/features/auth/password-reset.ts
- Create: src/features/auth/password-reset.test.ts
- Create: src/app/api/auth/forgot-password/route.ts
- Create: src/app/api/auth/reset-password/route.ts
- Create: src/app/(public)/forgot-password/page.tsx
- Create: src/app/(public)/reset-password/page.tsx
- Modify: .env.example

**Step 1: Write failing token lifecycle tests**

Test generic responses for unknown email, hashed storage, one-time use, expiration, and invalidation of existing sessions after reset.

Run: npm test -- src/features/auth/password-reset.test.ts

Expected: FAIL.

**Step 2: Implement adapters and service**

Install Nodemailer. Use a console adapter in development and SMTP only when explicit production environment variables exist. Never print a password or stored token digest.

**Step 3: Add pages and routes**

The forgot-password page always shows the same success message. The reset page accepts the opaque token and a new password, then redirects to the correct role login.

**Step 4: Verify and commit**

Run: npm test -- src/features/auth/password-reset.test.ts

Expected: PASS.

~~~powershell
git add src .env.example package.json package-lock.json
git commit -m "feat: add password recovery"
~~~

### Task 6: Implement regions, subjects, and deterministic matching

**Files:**
- Create: src/features/regions/repository.ts
- Create: src/features/regions/service.ts
- Create: src/features/matching/types.ts
- Create: src/features/matching/score.ts
- Create: src/features/matching/score.test.ts
- Create: src/app/api/regions/route.ts
- Create: src/components/forms/region-picker.tsx
- Modify: prisma/seed.ts

**Step 1: Write failing score tests**

Use fixtures proving this order: primary district, extra district, adjacent district, then online. Prove subject mismatch excludes a result and budget overlap improves rank without overriding region tiers.

Run: npm test -- src/features/matching/score.test.ts

Expected: FAIL.

**Step 2: Implement a pure scoring function**

Return an explicit tier and numeric secondary score. Keep database querying separate so ranking can be tested without PostgreSQL.

**Step 3: Add region lookup and picker**

Return province/city/district data from the API and support accessible dependent selects. Store only district IDs in profiles and requests.

**Step 4: Verify and commit**

Run: npm test -- src/features/matching/score.test.ts

Expected: PASS with every tier assertion.

~~~powershell
git add src prisma/seed.ts
git commit -m "feat: add region matching"
~~~

### Task 7: Build the teacher profile and dashboard

**Files:**
- Create: src/features/teachers/schema.ts
- Create: src/features/teachers/service.ts
- Create: src/features/teachers/service.test.ts
- Create: src/app/teacher/(app)/layout.tsx
- Create: src/app/teacher/(app)/dashboard/page.tsx
- Create: src/app/teacher/(app)/profile/page.tsx
- Create: src/app/api/teacher/profile/route.ts
- Create: src/components/teachers/profile-form.tsx
- Create: src/components/teachers/profile-card.tsx

**Step 1: Write failing profile rules**

Test one primary service area, no more than four extras, deduplication, valid hourly-rate bounds, required subjects, and ownership enforcement.

Run: npm test -- src/features/teachers/service.test.ts

Expected: FAIL.

**Step 2: Implement the service and route**

Use a transaction when replacing subjects and service areas. Return field-level validation errors. Never accept an account ID from the form.

**Step 3: Implement the dashboard UI**

Show profile completion, listing status, main district, extra districts, recent greetings, and matched requests. Provide a preview before publishing.

**Step 4: Verify and commit**

Run: npm test -- src/features/teachers/service.test.ts

Expected: PASS.

Run: npm run typecheck && npm run lint

Expected: exit 0.

~~~powershell
git add src
git commit -m "feat: add teacher profiles"
~~~

### Task 8: Build parent, student, and tutoring-request workflows

**Files:**
- Create: src/features/requests/schema.ts
- Create: src/features/requests/service.ts
- Create: src/features/requests/service.test.ts
- Create: src/app/parent/(app)/layout.tsx
- Create: src/app/parent/(app)/dashboard/page.tsx
- Create: src/app/parent/(app)/students/page.tsx
- Create: src/app/parent/(app)/requests/new/page.tsx
- Create: src/app/parent/(app)/requests/[id]/edit/page.tsx
- Create: src/app/api/parent/students/route.ts
- Create: src/app/api/parent/requests/route.ts
- Create: src/app/api/parent/requests/[id]/route.ts
- Create: src/components/requests/request-form.tsx
- Create: src/components/requests/request-card.tsx

**Step 1: Write failing ownership and lifecycle tests**

Cover create, edit, publish, close, reject invalid budgets, and prevent one parent editing another parent’s student or request.

Run: npm test -- src/features/requests/service.test.ts

Expected: FAIL.

**Step 2: Implement services and routes**

Bind every operation to the authenticated parent account. Keep exact address out of the schema; save only district and a public location note.

**Step 3: Implement forms and dashboard**

Provide draft saving, preview, publish/close actions, clear status badges, and empty states.

**Step 4: Verify and commit**

Run: npm test -- src/features/requests/service.test.ts

Expected: PASS.

~~~powershell
git add src
git commit -m "feat: add tutoring requests"
~~~

### Task 9: Connect public directories, filters, and detail access

**Files:**
- Create: src/features/directory/query.ts
- Create: src/features/directory/redaction.ts
- Create: src/features/directory/redaction.test.ts
- Create: src/app/(public)/teachers/page.tsx
- Create: src/app/(public)/teachers/[id]/page.tsx
- Create: src/app/(public)/requests/page.tsx
- Create: src/app/(public)/requests/[id]/page.tsx
- Create: src/components/directory/filter-bar.tsx
- Create: src/components/directory/circle-ribbon.tsx
- Create: src/app/api/directory/teachers/route.ts
- Create: src/app/api/directory/requests/route.ts

**Step 1: Write failing redaction tests**

Prove logged-out results exclude username, email, exact location notes, verification document paths, and private biography fields. Prove logged-in role-appropriate details include only the approved fields.

Run: npm test -- src/features/directory/redaction.test.ts

Expected: FAIL.

**Step 2: Implement query and redaction boundaries**

Paginate on the server. Whitelist returned fields instead of deleting sensitive keys after serialization.

**Step 3: Implement the directories**

Support district, subject, identity type, budget, and online/offline filters. Encode filters in the URL and render useful empty states. Logged-out detail calls to action lead to the correct portal login.

**Step 4: Verify and commit**

Run: npm test -- src/features/directory/redaction.test.ts

Expected: PASS.

~~~powershell
git add src
git commit -m "feat: add public directories"
~~~

### Task 10: Add favorites and the controlled greeting workflow

**Files:**
- Create: src/features/greetings/schema.ts
- Create: src/features/greetings/service.ts
- Create: src/features/greetings/service.test.ts
- Create: src/features/favorites/service.ts
- Create: src/app/api/greetings/route.ts
- Create: src/app/api/greetings/[id]/route.ts
- Create: src/app/api/favorites/route.ts
- Create: src/components/greetings/greeting-card.tsx
- Create: src/components/greetings/greeting-composer.tsx
- Create: src/components/greetings/greeting-inbox.tsx
- Create: src/app/teacher/(app)/greetings/page.tsx
- Create: src/app/parent/(app)/greetings/page.tsx

**Step 1: Write the greeting state-machine tests**

Test the 100-character limit, contact-detail rejection, one pending greeting per context, ten greetings per UTC day, seven-day expiry, thirty-day retry block after rejection, accept, reject, report, and block transitions.

Run: npm test -- src/features/greetings/service.test.ts

Expected: FAIL.

**Step 2: Implement the state machine transactionally**

Accepting a greeting must create exactly one conversation. Use database constraints plus a transaction to survive duplicate requests.

**Step 3: Build structured greeting cards**

Generate card fields on the server from current profile/request data. The user can edit only the 100-character note.

**Step 4: Verify and commit**

Run: npm test -- src/features/greetings/service.test.ts

Expected: PASS with every state transition.

~~~powershell
git add src
git commit -m "feat: add greeting workflow"
~~~

### Task 11: Implement text conversations with short polling

**Files:**
- Create: src/features/chat/service.ts
- Create: src/features/chat/service.test.ts
- Create: src/app/api/conversations/route.ts
- Create: src/app/api/conversations/[id]/messages/route.ts
- Create: src/app/api/conversations/[id]/read/route.ts
- Create: src/components/chat/conversation-list.tsx
- Create: src/components/chat/message-thread.tsx
- Create: src/components/chat/message-composer.tsx
- Create: src/app/teacher/(app)/messages/page.tsx
- Create: src/app/parent/(app)/messages/page.tsx

**Step 1: Write failing chat authorization tests**

Test conversation membership, accepted-greeting requirement, block enforcement, 1000-character message limit, unique clientMessageId idempotency, chronological pagination, and unread counts.

Run: npm test -- src/features/chat/service.test.ts

Expected: FAIL.

**Step 2: Implement message services**

Never trust sender IDs from the client. Return messages after a cursor for short polling and update read timestamps separately.

**Step 3: Build the responsive chat UI**

Use a two-pane desktop layout and a single-pane mobile route. Poll only while the tab is visible, pause on network failure with exponential backoff, and optimistically render messages keyed by clientMessageId.

**Step 4: Verify and commit**

Run: npm test -- src/features/chat/service.test.ts

Expected: PASS.

~~~powershell
git add src
git commit -m "feat: add text conversations"
~~~

### Task 12: Add reporting, blocking, verification, and the admin console

**Files:**
- Create: src/features/moderation/service.ts
- Create: src/features/moderation/service.test.ts
- Create: src/app/admin/(app)/layout.tsx
- Create: src/app/admin/(app)/page.tsx
- Create: src/app/admin/(app)/users/page.tsx
- Create: src/app/admin/(app)/reports/page.tsx
- Create: src/app/admin/(app)/verifications/page.tsx
- Create: src/app/api/reports/route.ts
- Create: src/app/api/blocks/route.ts
- Create: src/app/api/admin/reports/[id]/route.ts
- Create: src/app/api/admin/users/[id]/route.ts
- Create: src/app/api/admin/verifications/[id]/route.ts
- Create: src/components/admin/audit-timeline.tsx

**Step 1: Write failing moderation tests**

Cover report creation, self-report rejection, block side effects, admin-only access, account suspension, content takedown, verification decisions, and an audit row for every admin mutation.

Run: npm test -- src/features/moderation/service.test.ts

Expected: FAIL.

**Step 2: Implement moderation transactions**

Store verification metadata separately from public profile fields. For the MVP, use a local private upload directory only in development and document that production requires private object storage before enabling uploads.

**Step 3: Build the minimal admin console**

Use dense, utilitarian tables with status filters, reason fields, confirmation dialogs, and immutable audit history. Do not reuse the friendly public aesthetic where it reduces administrative clarity.

**Step 4: Verify and commit**

Run: npm test -- src/features/moderation/service.test.ts

Expected: PASS.

~~~powershell
git add src
git commit -m "feat: add moderation console"
~~~

### Task 13: Harden security, privacy, and operational behavior

**Files:**
- Create: src/lib/rate-limit.ts
- Create: src/lib/security-headers.ts
- Create: src/lib/logger.ts
- Create: src/features/accounts/deletion.ts
- Create: src/features/accounts/deletion.test.ts
- Create: src/app/api/account/delete/route.ts
- Modify: next.config.ts
- Modify: src/middleware.ts
- Modify: compose.yaml
- Modify: .env.example

**Step 1: Write failing privacy tests**

Test account anonymization, retention of minimal report/audit links, session revocation, log redaction, CSRF-sensitive mutation rejection, and safe security headers.

Run: npm test -- src/features/accounts/deletion.test.ts

Expected: FAIL.

**Step 2: Implement hardening**

Add Content-Security-Policy, frame restrictions, MIME sniffing protection, referrer policy, secure cookies, mutation origin checks, request size limits, and structured logs that redact email, cookies, reset tokens, and password fields.

**Step 3: Verify dependency and application health**

Run: npm audit --audit-level=high

Expected: no high or critical vulnerabilities.

Run: npm test && npm run typecheck && npm run lint

Expected: all pass.

**Step 4: Commit**

~~~powershell
git add src next.config.ts compose.yaml .env.example package.json package-lock.json
git commit -m "feat: harden platform security"
~~~

### Task 14: Add end-to-end tests, production build, and operating docs

> 2026-07-14 final deployment decision: the user selected a single VPS with Docker Compose and a custom domain. The approved design is `docs/plans/2026-07-14-docker-deployment-design.md`.

**Files:**
- Create: playwright.config.ts
- Create: e2e/teacher-parent-flow.spec.ts
- Create: e2e/access-control.spec.ts
- Create: e2e/public-redaction.spec.ts
- Create: Dockerfile
- Create: README.md
- Create: docs/operations/local-development.md
- Create: docs/operations/deployment.md
- Create: docs/operations/moderation.md
- Modify: package.json
- Modify: compose.yaml

**Step 1: Write the failing end-to-end flow**

The primary test must:

1. Register a parent and teacher through separate portals.
2. Create a student and publish a tutoring request.
3. Publish a teacher profile with one primary and four extra districts.
4. Match the teacher to the request.
5. Send a structured greeting and accept it.
6. Exchange two text messages.
7. Confirm a logged-out user sees only redacted data.

Run: npm run test:e2e -- e2e/teacher-parent-flow.spec.ts

Expected: FAIL until fixtures and all routes are wired.

**Step 2: Add deterministic E2E setup**

Use a dedicated test database, seed predictable regions/subjects, reset it before the suite, and capture trace plus screenshot only on failure.

**Step 3: Document local and production operation**

README must include prerequisites, environment variables, database startup, migration, seed, test, build, and common troubleshooting commands. Deployment docs must state that SMTP and private object storage are required before production password recovery or verification uploads are enabled.

**Step 4: Run the full release gate**

Run:

~~~powershell
docker compose up -d db
npx prisma migrate deploy
npm test
npm run test:e2e
npm run typecheck
npm run lint
npm run build
npm audit --audit-level=high
git diff --check
~~~

Expected: all unit, integration, and E2E tests pass; typecheck, lint, build, audit, and whitespace checks exit 0.

**Step 5: Perform visual QA**

Run the app and inspect desktop and mobile screenshots for the homepage, both directories, teacher dashboard, parent dashboard, greeting inbox, chat, and admin reports. Check overflow, focus states, empty states, loading states, reduced motion, and Chinese line wrapping.

**Step 6: Commit**

~~~powershell
git add .
git commit -m "test: verify tutor platform MVP"
~~~

## Final branch verification

Run:

~~~powershell
git status -sb
git log --oneline --decorate -15
npm test
npm run test:e2e
npm run typecheck
npm run lint
npm run build
~~~

Expected: clean codex/development worktree and every release gate passing. Then use @finishing-a-development-branch to offer merge, PR, or cleanup options and synchronize the chosen result to GitHub.
