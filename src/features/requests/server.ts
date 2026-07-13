import "server-only";

import { db } from "@/lib/db";

import { PrismaRequestRepository } from "./repository";
import { createRequestService } from "./service";

let cached: ReturnType<typeof createRequestService> | undefined;
export function getRequestService() {
  cached ??= createRequestService(new PrismaRequestRepository(db));
  return cached;
}
