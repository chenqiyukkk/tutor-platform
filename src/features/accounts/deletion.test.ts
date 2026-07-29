import { describe, expect, it, vi } from "vitest";

import { AccountDeletionError, createAccountDeletionService, type AccountDeletionRepository } from "./deletion";

const actor = { id: "10000000-0000-4000-8000-000000000001", role: "teacher" as const };

function repository(overrides: Partial<AccountDeletionRepository> = {}): AccountDeletionRepository {
  return {
    loadForDeletion: vi.fn().mockResolvedValue({ id: actor.id, role: "teacher", status: "active", passwordHash: "hash" }),
    anonymize: vi.fn().mockResolvedValue({ evidenceKeys: ["a".repeat(64) + ".jpg"] }),
    ...overrides,
  };
}

describe("account deletion", () => {
  it("requires the current password and never permits administrator deletion", async () => {
    const repo = repository();
    const service = createAccountDeletionService({ repository: repo, verifyPasswordHash: vi.fn().mockResolvedValue(false) });
    await expect(service.delete(actor, { confirmation: "注销账户", password: "wrong-password" })).rejects.toEqual(expect.objectContaining({ code: "INVALID_CREDENTIALS" }));
    await expect(service.delete({ ...actor, role: "admin" }, { confirmation: "注销账户", password: "valid-password" })).rejects.toEqual(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(repo.anonymize).not.toHaveBeenCalled();
  });

  it("anonymizes transactionally, revokes personal data and removes private evidence", async () => {
    const repo = repository();
    const remove = vi.fn().mockResolvedValue(undefined);
    const service = createAccountDeletionService({
      repository: repo,
      storage: { remove },
      verifyPasswordHash: vi.fn().mockResolvedValue(true),
      hashPasswordHash: vi.fn().mockResolvedValue("unusable-hash"),
      now: () => new Date("2026-07-14T00:00:00.000Z"),
    });
    await expect(service.delete(actor, { confirmation: "注销账户", password: "valid-password" })).resolves.toEqual({ deleted: true });
    expect(repo.anonymize).toHaveBeenCalledWith(expect.objectContaining({
      accountId: actor.id,
      expectedPasswordHash: "hash",
      username: "已注销用户",
      normalizedUsername: `deleted:${actor.id}`,
      email: `deleted-${actor.id}@invalid.local`,
      passwordHash: "unusable-hash",
    }));
    expect(remove).toHaveBeenCalledWith("a".repeat(64) + ".jpg");
  });

  it("returns a safe conflict when the account changes between password check and transaction", async () => {
    const service = createAccountDeletionService({
      repository: repository({ anonymize: vi.fn().mockRejectedValue(new AccountDeletionError("CONFLICT", "changed")) }),
      verifyPasswordHash: vi.fn().mockResolvedValue(true),
    });
    await expect(service.delete(actor, { confirmation: "注销账户", password: "valid-password" })).rejects.toEqual(expect.objectContaining({ code: "CONFLICT" }));
  });
});
