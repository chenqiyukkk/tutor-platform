import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { accountPairLockKey, lockAccountPair } from "./account-pair-lock";

describe("canonical account-pair advisory lock", () => {
  it("uses one stable key regardless of account direction", () => {
    const teacher = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const parent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    expect(accountPairLockKey(teacher, parent)).toBe(accountPairLockKey(parent, teacher));
    expect(accountPairLockKey(teacher, parent)).toBe(`greeting-pair:${parent}:${teacher}`);
  });

  it("takes a transaction-scoped PostgreSQL advisory lock with that key", async () => {
    const queryRaw = vi.fn(async () => [{ locked: 1 }]);
    const transaction = { $queryRaw: queryRaw };

    await lockAccountPair(
      transaction as never,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(queryRaw.mock.calls[0]).toContain("greeting-pair:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });
});
