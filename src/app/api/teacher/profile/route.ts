import { requireSessionRole } from "@/features/auth/guards";
import { getAuthService } from "@/features/auth/server";
import { createTeacherProfileHandlers } from "@/features/teachers/route-handler";
import { getTeacherProfileService } from "@/features/teachers/server";

const handlers = createTeacherProfileHandlers({
  authenticate: (token) => requireSessionRole(getAuthService(), "teacher", token),
  service: getTeacherProfileService(),
});

export const { GET, POST, PUT } = handlers;
