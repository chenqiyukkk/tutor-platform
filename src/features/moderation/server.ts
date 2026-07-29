import "server-only";

import { getAuthService } from "@/features/auth/server";
import { db } from "@/lib/db";

import { createModerationHandlers } from "./route-handler";
import { createModerationService } from "./service";

export const moderationService = createModerationService(db);

export const moderationHandlers = createModerationHandlers({
  authenticate: (role, token) => getAuthService().getSession(role, token),
  moderationService,
});
