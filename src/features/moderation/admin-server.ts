import "server-only";

import { getAuthService } from "@/features/auth/server";
import { verificationStorage } from "@/features/verifications/server";
import { db } from "@/lib/db";

import { createAdminModerationHandlers } from "./admin-route-handler";
import { createAdminModerationService } from "./admin-service";

export const adminModerationService = createAdminModerationService(db, verificationStorage);

export const adminModerationHandlers = createAdminModerationHandlers({
  authenticate: (_role, token) => getAuthService().getSession("admin", token),
  moderationService: adminModerationService,
});
