import { z } from "zod";

const cursorPayloadSchema = z.object({
  createdAt: z.string().datetime({ offset: false, precision: 3 }),
  id: z.string().uuid(),
}).strict();

export type FavoriteCursor = { createdAt: Date; id: string };

export function encodeFavoriteCursor(cursor: FavoriteCursor) {
  return Buffer.from(JSON.stringify({
    createdAt: cursor.createdAt.toISOString(),
    id: cursor.id,
  }), "utf8").toString("base64url");
}

export function decodeFavoriteCursor(value: string): FavoriteCursor {
  if (value.length < 1 || value.length > 256 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("invalid favorite cursor");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("non-canonical favorite cursor");
  const payload = cursorPayloadSchema.parse(JSON.parse(decoded.toString("utf8")));
  const createdAt = new Date(payload.createdAt);
  if (createdAt.toISOString() !== payload.createdAt) throw new Error("non-canonical favorite cursor date");
  return { createdAt, id: payload.id };
}

export const favoriteListQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(256).refine((value) => {
    try {
      decodeFavoriteCursor(value);
      return true;
    } catch {
      return false;
    }
  }, "分页游标无效").optional(),
}).strict();

export type FavoriteListQuery = z.infer<typeof favoriteListQuerySchema>;
