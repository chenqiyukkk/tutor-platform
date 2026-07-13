import "server-only";

import { db } from "@/lib/db";

import { PrismaDirectoryRepository } from "./repository";
import { createDirectoryHandlers } from "./route-handler";

export const directoryRepository = new PrismaDirectoryRepository(db);
export const directoryHandlers = createDirectoryHandlers(directoryRepository);
