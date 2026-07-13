-- Demote legacy rows that no longer satisfy the public-content contract.
-- Application write validation and read-boundary filtering remain the primary
-- defenses; this migration removes already-published unsafe snapshots.
UPDATE "TeacherProfile"
SET "status" = 'DRAFT',
    "publishedAt" = NULL
WHERE "status" = 'PUBLISHED'
  AND (
    "headline" IS NULL
    OR btrim("headline") = ''
    OR concat_ws(' ', "displayName", "headline", "bio") ~* (
      '(微[[:space:]]*信|wechat|weixin|whats?[[:space:]]*app|telegram|小[[:space:]]*红[[:space:]]*书|xiaohongshu|抖[[:space:]]*音|douyin|tik[[:space:]]*tok|二[[:space:]]*维[[:space:]]*码|扫码|手机号|手机号码|电话号|邮箱|联系[[:space:]]*方式|加[[:space:]]*好友|外部[[:space:]]*付费|转账)'
      || '|(^|[^[:alnum:]])(red|line|signal)[[:space:]]*(号|id|[:：@])'
      || '|https?://|www\.'
      || '|[[:alnum:]_.%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
      || '|[[:alnum:]][[:alnum:].-]*\.(com|cn|net|org|io|co|me|app|dev|xyz|top|site|online|tech|edu|gov|info|biz|club|pro|cc|tv)([^[:alnum:]]|$)'
    )
  );

UPDATE "TutoringRequest" AS request
SET "status" = 'DRAFT',
    "publishedAt" = NULL,
    "closedAt" = NULL
WHERE request."status" = 'PUBLISHED'
  AND (
    concat_ws(' ', request."title", request."description", request."schedule", request."publicLocationNote") ~* (
      '(微[[:space:]]*信|wechat|weixin|whats?[[:space:]]*app|telegram|小[[:space:]]*红[[:space:]]*书|xiaohongshu|抖[[:space:]]*音|douyin|tik[[:space:]]*tok|二[[:space:]]*维[[:space:]]*码|扫码|手机号|手机号码|电话号|邮箱|联系[[:space:]]*方式|加[[:space:]]*好友|外部[[:space:]]*付费|转账)'
      || '|(^|[^[:alnum:]])(red|line|signal)[[:space:]]*(号|id|[:：@])'
      || '|https?://|www\.'
      || '|[[:alnum:]_.%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
      || '|[[:alnum:]][[:alnum:].-]*\.(com|cn|net|org|io|co|me|app|dev|xyz|top|site|online|tech|edu|gov|info|biz|club|pro|cc|tv)([^[:alnum:]]|$)'
    )
    OR EXISTS (
      SELECT 1
      FROM "StudentProfile"
      WHERE "StudentProfile"."id" = request."studentProfileId"
        AND "StudentProfile"."displayName" ~* (
          '(微[[:space:]]*信|wechat|weixin|whats?[[:space:]]*app|telegram|小[[:space:]]*红[[:space:]]*书|xiaohongshu|抖[[:space:]]*音|douyin|tik[[:space:]]*tok|二[[:space:]]*维[[:space:]]*码|扫码|手机号|手机号码|电话号|邮箱|联系[[:space:]]*方式|加[[:space:]]*好友|外部[[:space:]]*付费|转账)'
          || '|(^|[^[:alnum:]])(red|line|signal)[[:space:]]*(号|id|[:：@])'
          || '|https?://|www\.'
          || '|[[:alnum:]_.%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
          || '|[[:alnum:]][[:alnum:].-]*\.(com|cn|net|org|io|co|me|app|dev|xyz|top|site|online|tech|edu|gov|info|biz|club|pro|cc|tv)([^[:alnum:]]|$)'
        )
    )
  );
