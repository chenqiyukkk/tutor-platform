import "server-only";

import { getAuthService } from "@/features/auth/server";
import { db } from "@/lib/db";

import { createFavoriteHandlers } from "./route-handler";
import { createFavoriteService } from "./service";

export const favoriteService = createFavoriteService(db);

export const favoriteHandlers = createFavoriteHandlers({
  authenticate: (role, token) => getAuthService().getSession(role, token),
  favoriteService,
});
