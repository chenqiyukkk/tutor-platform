import "server-only";

import { db } from "@/lib/db";
import { getAuthService } from "@/features/auth/server";

import { createDirectoryDetailAuthorizer } from "./detail-auth";
import { PrismaDirectoryRepository } from "./repository";
import { createDirectoryHandlers } from "./route-handler";

export const directoryRepository = new PrismaDirectoryRepository(db);

const authorizeDirectoryDetail = createDirectoryDetailAuthorizer(
  (role, token) => getAuthService().getSession(role, token),
);

export const directoryHandlers = createDirectoryHandlers(
  directoryRepository,
  authorizeDirectoryDetail,
);
