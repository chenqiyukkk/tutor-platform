import "server-only";

import { getAuthService } from "@/features/auth/server";
import { verificationStorage } from "@/features/verifications/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

import { createAccountDeletionService } from "./deletion";
import { PrismaAccountDeletionRepository } from "./deletion-prisma";
import { createAccountDeletionHandler } from "./deletion-route";

export const accountDeletionService = createAccountDeletionService({
  repository: new PrismaAccountDeletionRepository(db),
  storage: verificationStorage,
  logCleanupFailure: (key) => logger.error("account deletion evidence cleanup pending", { evidenceKey: key }),
});

export const accountDeletionHandler = createAccountDeletionHandler({
  authenticate: (role, token) => getAuthService().getSession(role, token),
  deletionService: accountDeletionService,
});
