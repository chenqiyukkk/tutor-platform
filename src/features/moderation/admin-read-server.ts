import "server-only";

import { db } from "@/lib/db";

import { createAdminReadService } from "./admin-read-service";

export const adminReadService = createAdminReadService(db);
