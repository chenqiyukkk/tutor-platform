import "server-only";

import { getAuthService } from "@/features/auth/server";
import { db } from "@/lib/db";

import { createChatHandlers } from "./route-handler";
import { createChatService } from "./service";

export const chatService = createChatService(db);
export const chatHandlers = createChatHandlers({
  authenticate: (role, token) => getAuthService().getSession(role, token),
  chatService,
});
