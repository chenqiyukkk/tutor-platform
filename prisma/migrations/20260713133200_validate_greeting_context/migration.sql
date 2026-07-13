-- Refuse to carry forward a legacy greeting whose participants do not form
-- exactly one TEACHER + one PARENT pair, with that parent owning the request.
DO $validate_greeting_context$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Greeting" AS greeting
    JOIN "Account" AS sender ON sender.id = greeting."senderAccountId"
    JOIN "Account" AS recipient ON recipient.id = greeting."recipientAccountId"
    JOIN "TutoringRequest" AS request ON request.id = greeting."tutoringRequestId"
    JOIN "ParentProfile" AS parent_profile ON parent_profile.id = request."parentProfileId"
    WHERE NOT (
      ARRAY[sender.role::text, recipient.role::text] @> ARRAY['TEACHER', 'PARENT']
      AND ARRAY[sender.role::text, recipient.role::text] <@ ARRAY['TEACHER', 'PARENT']
      AND parent_profile."accountId" IN (sender.id, recipient.id)
    )
  ) THEN
    RAISE EXCEPTION 'Invalid legacy greeting context: expected one teacher and the request-owning parent';
  END IF;
END
$validate_greeting_context$;
