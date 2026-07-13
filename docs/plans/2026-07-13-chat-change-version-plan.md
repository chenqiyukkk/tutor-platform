# Chat change-version correctness plan

> Execution discipline: each behavior below starts with a failing test, then the smallest implementation change, then focused and full verification.

## Goal

Replace timestamp/UUID message-change polling with a commit-order-safe `BIGINT` version, preserve the existing public JSON DTO, and close the modal/live-region/conversation-pagination review gaps.

## Database contract

- Add forward migration `20260713133800_chat_message_change_version`; never rewrite `20260713133700_chat_message_change_polling`.
- Add `Message.changeVersion BIGINT`, a database sequence, and a `BEFORE INSERT OR UPDATE` trigger.
- The trigger loads the conversation participants, acquires `pg_advisory_xact_lock(hashtextextended('greeting-pair:' || least(uuid text) || ':' || greatest(uuid text), 0))`, and only then calls `nextval`.
- Reject a message `conversationId` change in the trigger so a mutation cannot escape the original pair namespace.
- Backfill existing rows through the trigger, make the column non-null, and replace the superseded `(conversationId, updatedAt, id)` index with `(conversationId, changeVersion)`.
- Initial history already owns the same pair lock and allocates a sequence watermark inside that transaction. Therefore earlier same-pair mutations must finish first and later same-pair mutations receive a greater version.

## Service and cursor contract

- `changesAfter` is a strict canonical non-negative decimal PostgreSQL `BIGINT`; reject whitespace, sign, leading zero (except the canonical value `0`), exponent notation, legacy Base64URL, and overflow.
- Poll with `changeVersion > cursor`, ordered only by ascending `changeVersion`, taking `limit + 1`.
- Keep `changeVersion` in the internal Prisma select, but omit it from `ChatMessageDto` so no JavaScript `bigint` reaches JSON serialization.
- Let the database trigger version every insert/update, including Prisma `create`, `update`, `updateMany`, and raw SQL.

## UI contract

- Render the block flow as native `<dialog>` synchronized with `showModal()`, `cancel`, and `close`; close through the dialog lifecycle and restore focus to the trigger.
- Keep only the message list as the single `role="log"` / `aria-live` region.
- Track the first-page continuation, loaded page count, and pagination revision. A successful first-page poll marks loaded later pages dirty. The next load-more action rebuilds all loaded continuations from the latest first-page cursor before extending one page, so an item moving into ranks 101–200 is not skipped.

## RED tests

- Cursor schema accepts only canonical decimal versions.
- Unit service test proves initial watermark allocation occurs after the pair lock and polling uses `changeVersion` only.
- PostgreSQL integration tests cover same-millisecond/lower-UUID mutation, `limit=1` multi-page polling, delayed raw mutation versus initial watermark, and two raw same-pair transactions proving the second trigger blocks before sequence allocation until the first commits.
- Schema and migration-upgrade tests require the 17th migration, `BIGINT`, sequence, trigger, canonical lock namespace/order, replacement index, and successful legacy upgrade.
- Component tests require the native dialog lifecycle/focus restoration, a single live region, and dirty multi-page conversation pagination rebuilt from the new first-page waterline.

## Verification

- Focused schema/service/component/PostgreSQL integration suites.
- Full `npm test` (the repository is npm/`package-lock.json`; do not create pnpm artifacts), migration-upgrade suite, Prisma validate/status/diff, typecheck, lint, and production build.
- Review `git diff`, worktree status, and make focused local commit(s) without push.
