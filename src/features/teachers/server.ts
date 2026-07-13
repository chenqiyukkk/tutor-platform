import "server-only";

import { db } from "@/lib/db";

import { PrismaTeacherProfileRepository } from "./repository";
import { createTeacherProfileService } from "./service";

let cachedService: ReturnType<typeof createTeacherProfileService> | undefined;

export function getTeacherProfileService() {
  if (!cachedService) {
    cachedService = createTeacherProfileService(new PrismaTeacherProfileRepository(db));
  }
  return cachedService;
}
