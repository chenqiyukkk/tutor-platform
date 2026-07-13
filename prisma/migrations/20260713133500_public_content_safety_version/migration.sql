BEGIN;

LOCK TABLE "TeacherProfile" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "TutoringRequest" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "StudentProfile" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "TeacherProfile"
  ADD COLUMN "publicContentSafetyVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TutoringRequest"
  ADD COLUMN "publicContentSafetyVersion" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION "public_content_unsafe_v1"(input TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $function$
  WITH normalized AS (
    SELECT normalize(coalesce(input, ''), NFKC) AS value
  ), compact AS (
    SELECT value, regexp_replace(value, '[[:space:]./()_,，、•·:：-]', '', 'g') AS phone
    FROM normalized
  )
  SELECT
    coalesce(input, '') ~ U&'[\00AD\061C\180E\200B-\200F\202A-\202E\2060-\2064\2066-\206F\FEFF]'
    OR value ~* (
      '(微[[:space:]]*信|wechat|weixin|whats?[[:space:]]*app|telegram|小[[:space:]]*红[[:space:]]*书|xiaohongshu|抖[[:space:]]*音|douyin|tik[[:space:]]*tok|二[[:space:]]*维[[:space:]]*码|扫码|手机号|手机号码|电话号|邮箱|联系[[:space:]]*方式|加[[:space:]]*好友|外部[[:space:]]*付费|转账)'
      || '|(^|[^[:alnum:]])(red|line|signal)[[:space:]]*(号|id|[:：@])'
      || '|https?://|www\.'
      || '|[[:alnum:]_.%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
      || '|[[:alnum:]][[:alnum:].-]*\.(com|cn|net|org|io|co|me|app|dev|xyz|top|site|online|tech|edu|gov|info|biz|club|pro|cc|tv)([^[:alnum:]]|$)'
    )
    OR phone ~ '(^|[^0-9])([+]?86)?1[3-9][0-9]{9}([^0-9]|$)'
    OR phone ~ '(^|[^0-9])([+]?86)?0[0-9]{9,11}([^0-9]|$)'
  FROM compact;
$function$;

UPDATE "TeacherProfile"
SET "status" = 'DRAFT',
    "publishedAt" = NULL,
    "publicContentSafetyVersion" = 0
WHERE "status" = 'PUBLISHED'
  AND (
    "headline" IS NULL
    OR btrim("headline") = ''
    OR "public_content_unsafe_v1"(concat_ws(' ', "displayName", "headline", "bio"))
  );

UPDATE "TutoringRequest" AS request
SET "status" = 'DRAFT',
    "publishedAt" = NULL,
    "closedAt" = NULL,
    "publicContentSafetyVersion" = 0
WHERE request."status" = 'PUBLISHED'
  AND (
    "public_content_unsafe_v1"(concat_ws(' ', request."title", request."description", request."schedule", request."publicLocationNote"))
    OR EXISTS (
      SELECT 1
      FROM "StudentProfile"
      WHERE "StudentProfile"."id" = request."studentProfileId"
        AND "public_content_unsafe_v1"("StudentProfile"."displayName")
    )
  );

UPDATE "TeacherProfile"
SET "publicContentSafetyVersion" = 1
WHERE "status" = 'PUBLISHED'
  AND "publishedAt" IS NOT NULL
  AND "headline" IS NOT NULL
  AND btrim("headline") <> ''
  AND NOT "public_content_unsafe_v1"(concat_ws(' ', "displayName", "headline", "bio"));

UPDATE "TutoringRequest" AS request
SET "publicContentSafetyVersion" = 1
WHERE request."status" = 'PUBLISHED'
  AND request."publishedAt" IS NOT NULL
  AND NOT "public_content_unsafe_v1"(concat_ws(' ', request."title", request."description", request."schedule", request."publicLocationNote"))
  AND NOT EXISTS (
    SELECT 1
    FROM "StudentProfile"
    WHERE "StudentProfile"."id" = request."studentProfileId"
      AND "public_content_unsafe_v1"("StudentProfile"."displayName")
  );

CREATE INDEX "TeacherProfile_status_publicContentSafetyVersion_publishedA_idx"
  ON "TeacherProfile"("status", "publicContentSafetyVersion", "publishedAt" DESC, "id");
CREATE INDEX "TutoringRequest_status_publicContentSafetyVersion_published_idx"
  ON "TutoringRequest"("status", "publicContentSafetyVersion", "publishedAt" DESC, "id");

DROP FUNCTION "public_content_unsafe_v1"(TEXT);

COMMIT;
