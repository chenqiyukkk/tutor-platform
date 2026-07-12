import "server-only";

import { db } from "@/lib/db";
import { getServerEnv } from "@/lib/env";

import { PrismaAuthRepository } from "./prisma-repository";
import { createAuthService } from "./service";

export const authService = createAuthService({
  repository: new PrismaAuthRepository(db),
  sessionSecret: getServerEnv().SESSION_SECRET,
});
