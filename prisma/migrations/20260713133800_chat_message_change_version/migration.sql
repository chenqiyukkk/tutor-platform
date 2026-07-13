BEGIN;

CREATE SEQUENCE "Message_changeVersion_seq"
  AS BIGINT
  MINVALUE 1
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;

ALTER TABLE "Message"
  ADD COLUMN "changeVersion" BIGINT;

CREATE FUNCTION "assign_message_change_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  conversation_record RECORD;
  pair_key TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."conversationId" IS DISTINCT FROM OLD."conversationId" THEN
    RAISE EXCEPTION 'Message.conversationId cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  SELECT conversation."teacherId", conversation."parentId"
  INTO conversation_record
  FROM "Conversation" AS conversation
  WHERE conversation."id" = NEW."conversationId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message conversation does not exist'
      USING ERRCODE = '23503';
  END IF;

  pair_key := 'greeting-pair:'
    || LEAST(conversation_record."teacherId"::text, conversation_record."parentId"::text)
    || ':'
    || GREATEST(conversation_record."teacherId"::text, conversation_record."parentId"::text);

  PERFORM pg_advisory_xact_lock(hashtextextended(pair_key, 0));
  NEW."changeVersion" := nextval('"Message_changeVersion_seq"');
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "Message_assign_change_version"
BEFORE INSERT OR UPDATE ON "Message"
FOR EACH ROW
EXECUTE FUNCTION "assign_message_change_version"();

UPDATE "Message"
SET "changeVersion" = 0;

ALTER TABLE "Message"
  ALTER COLUMN "changeVersion" SET NOT NULL,
  ALTER COLUMN "changeVersion" SET DEFAULT 0;

CREATE INDEX "Message_conversationId_changeVersion_idx"
  ON "Message"("conversationId", "changeVersion");

DROP INDEX "Message_conversationId_updatedAt_id_idx";

COMMIT;
