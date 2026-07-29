import "server-only";

import { type Prisma } from "@prisma/client";

export function accountPairLockKey(leftAccountId: string, rightAccountId: string) {
  return `greeting-pair:${[leftAccountId, rightAccountId].sort().join(":")}`;
}

export async function lockAccountPair(
  transaction: Prisma.TransactionClient,
  leftAccountId: string,
  rightAccountId: string,
) {
  const key = accountPairLockKey(leftAccountId, rightAccountId);
  await transaction.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
