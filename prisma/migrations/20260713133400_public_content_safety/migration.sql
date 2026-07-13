BEGIN;

-- Freeze public-text writers while the legacy scan runs. The order is part of
-- the application-wide lock contract and must remain stable.
LOCK TABLE "TeacherProfile" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "TutoringRequest" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "StudentProfile" IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION "public_content_unsafe_v1"(input TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $function$
  -- Keep this function byte-for-byte aligned with 133500. Remove every Cf
  -- code point before NFKC so format controls cannot split contact tokens.
  WITH without_format AS (
    SELECT regexp_replace(
      coalesce(input, ''),
      U&'[\00AD\0600-\0605\061C\06DD\070F\0890-\0891\08E2\180E\200B-\200F\202A-\202E\2060-\2064\2066-\206F\FEFF\FFF9-\FFFB\+0110BD\+0110CD\+013430-\+01343F\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0001\+0E0020-\+0E007F]',
      '',
      'g'
    ) AS value
  ), normalized AS (
    -- NFKC folds fullwidth ASCII (U+FF01..U+FF5E), including ＷｈａｔｓＡｐｐ.
    SELECT normalize(value, NFKC) AS value
    FROM without_format
  ), compact AS (
    SELECT value, regexp_replace(value, '[[:space:]./()_,，、•·:：-]', '', 'g') AS phone
    FROM normalized
  )
  SELECT
    value ~* (
      '(微[[:space:]]*信|微[[:space:]]*xin|wei[[:space:]]*xin|we[[:space:]]*chat|wechat|weixin|v[[:space:]]*信)'
      || '|(^|[^A-Za-z0-9])(w[[:space:]]*x|v[[:space:]]*x)([[:space:]]*(号|id|[:：])|[[:space:]]+[[:alnum:]_-]{2,}|[[:space:]]*$)'
      || '|(^|[^A-Za-z])q[[:space:]]*q([^A-Za-z]|$)|扣[[:space:]]*扣'
      || '|whats?[[:space:]]*app|w[[:space:]]*h[[:space:]]*a[[:space:]]*t[[:space:]]*s[[:space:]]*a[[:space:]]*p[[:space:]]*p'
      || '|tele[[:space:]]*gram'
      || '|(^|[^A-Za-z0-9])t[[:space:]]*g([[:space:]]*(号|id|[:：@])|[[:space:]]+[[:alnum:]_-]{2,}|[[:space:]]*$)'
      || '|小[[:space:]]*红[[:space:]]*书|xiao[[:space:]]*hong[[:space:]]*shu'
      || '|(^|[^A-Za-z])red[[:space:]]*(号|id|[:：@])'
      || '|抖[[:space:]]*音|dou[[:space:]]*yin|tik[[:space:]]*tok'
      || '|(^|[^A-Za-z])line[[:space:]]*(号|id|[:：@])'
      || '|(^|[^A-Za-z])signal[[:space:]]*(号|id|[:：@])'
      || '|二[[:space:]]*维[[:space:]]*码|扫码'
      || '|[[:alnum:]_.%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
      || '|(https?://|www\.)[^[:space:]]+'
      || '|[[:alnum:]][[:alnum:].-]*\.(com|cn|net|org|io|co|me|app|dev|xyz|top|site|online|tech|edu|gov|info|biz|club|pro|cc|tv)([^[:alnum:]]|$)'
      || '|加[[:space:]]*好友|付[[:space:]]*(信息|中介)[[:space:]]*费|外部[[:space:]]*付费|转账'
      || '|联系[[:space:]]*方式|手机号|手机号码|电话号|邮箱|私聊发|座机'
    )
    -- Compact separators exactly like runtime policy. Representative mobile:
    -- 13800138000; representative landline forms include 010-88886666.
    OR phone ~ '(^|[^0-9])([+]?86)?1[3-9][0-9]{9}([^0-9]|$)'
    OR phone ~ '(^|[^0-9])([+]?86)?0[0-9]{9,11}([^0-9]|$)'
  FROM compact;
$function$;

UPDATE "TeacherProfile"
SET "status" = 'DRAFT',
    "publishedAt" = NULL
WHERE "status" = 'PUBLISHED'
  AND (
    btrim("displayName") = ''
    OR "headline" IS NULL
    OR btrim("headline") = ''
    OR "bio" IS NULL
    OR btrim("bio") = ''
    OR "public_content_unsafe_v1"("displayName")
    OR "public_content_unsafe_v1"("headline")
    OR "public_content_unsafe_v1"("bio")
  );

UPDATE "TutoringRequest" AS request
SET "status" = 'DRAFT',
    "publishedAt" = NULL,
    "closedAt" = NULL
WHERE request."status" = 'PUBLISHED'
  AND (
    btrim(request."title") = ''
    OR btrim(request."description") = ''
    OR "public_content_unsafe_v1"(request."title")
    OR "public_content_unsafe_v1"(request."description")
    OR "public_content_unsafe_v1"(request."schedule")
    OR "public_content_unsafe_v1"(request."publicLocationNote")
    OR NOT EXISTS (
      SELECT 1
      FROM "StudentProfile"
      WHERE "StudentProfile"."id" = request."studentProfileId"
        AND "StudentProfile"."isActive" = true
        AND btrim("StudentProfile"."displayName") <> ''
        AND NOT "public_content_unsafe_v1"("StudentProfile"."displayName")
    )
  );

DROP FUNCTION "public_content_unsafe_v1"(TEXT);

COMMIT;
