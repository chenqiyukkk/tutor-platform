import "server-only";

import { getAuthService } from "@/features/auth/server";
import { createFavoriteService } from "@/features/favorites/service";
import { db } from "@/lib/db";

import { createInteractionHandlers } from "./route-handler";
import { createGreetingService } from "./service";

export const greetingService = createGreetingService(db);
export const favoriteService = createFavoriteService(db);

export const interactionHandlers = createInteractionHandlers({
  authenticate: (role, token) => getAuthService().getSession(role, token),
  greetingService,
  favoriteService,
});
