import "server-only";

import { requireSessionRole } from "@/features/auth/guards";
import { getAuthService } from "@/features/auth/server";

import { createRequestHandlers, createStudentHandlers } from "./route-handler";
import { getRequestService } from "./server";

const dependencies = {
  authenticate: (token: string | undefined) => requireSessionRole(getAuthService(), "parent", token),
  service: getRequestService(),
};

export const parentStudentHandlers = createStudentHandlers(dependencies);
export const parentRequestHandlers = createRequestHandlers(dependencies);
