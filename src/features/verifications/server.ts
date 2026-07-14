import "server-only";

import { getAuthService } from "@/features/auth/server";
import { db } from "@/lib/db";

import { createVerificationHandlers } from "./route-handler";
import { createPrismaVerificationRepository, createVerificationService } from "./service";
import { createLocalPrivateEvidenceStorage } from "./storage";

export const verificationStorage = createLocalPrivateEvidenceStorage({
  rootDir: process.env.VERIFICATION_UPLOAD_DIR,
  nodeEnv: process.env.NODE_ENV,
});

export const verificationService = createVerificationService(
  createPrismaVerificationRepository(db),
  verificationStorage,
);

export const verificationHandlers = createVerificationHandlers({
  authenticate: (_role, token) => getAuthService().getSession("teacher", token),
  verificationService,
  uploadEnabled: verificationStorage.enabled,
});
