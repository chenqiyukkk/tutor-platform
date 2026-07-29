// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { EvidencePersistenceError, type PrivateEvidence, type PrivateEvidenceStorage } from "./storage";
import {
  VerificationWorkflowError,
  createVerificationService,
  type VerificationRecord,
  type VerificationRepository,
} from "./service";

const accountId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const verificationId = "44444444-4444-4444-8444-444444444444";
const submittedAt = new Date("2026-07-14T01:00:00.000Z");
const evidence: PrivateEvidence = {
  provider: "local-private",
  key: `${"a".repeat(64)}.jpg`,
  mimeType: "image/jpeg",
  byteSize: 321,
  sha256: "b".repeat(64),
};

function record(overrides: Partial<VerificationRecord> = {}): VerificationRecord {
  return {
    id: verificationId,
    accountId,
    teacherProfileId: profileId,
    clientRequestId: requestId,
    type: "STUDENT_STATUS",
    status: "PENDING",
    evidence,
    reviewNote: null,
    submittedAt,
    reviewedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

function setup(overrides: Partial<VerificationRepository> = {}, enabled = true) {
  const rows: VerificationRecord[] = [];
  const repository: VerificationRepository = {
    transaction: async (operation) => operation(repository),
    getApplicant: vi.fn().mockResolvedValue({
      accountId,
      role: "TEACHER",
      status: "ACTIVE",
      teacherProfileId: profileId,
    }),
    listByAccount: vi.fn().mockImplementation(async () => rows),
    findByClientRequestId: vi.fn().mockImplementation(async (_accountId, clientRequestId) =>
      rows.find((item) => item.clientRequestId === clientRequestId) ?? null),
    findPendingByType: vi.fn().mockImplementation(async (_accountId, type) =>
      rows.find((item) => item.type === type && item.status === "PENDING") ?? null),
    create: vi.fn().mockImplementation(async (input) => {
      const created = record(input);
      rows.push(created);
      return created;
    }),
    ...overrides,
  };
  const storage: PrivateEvidenceStorage = {
    enabled,
    write: vi.fn().mockResolvedValue(evidence),
    read: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  return { repository, storage, service: createVerificationService(repository, storage) };
}

const teacher = { id: accountId, role: "teacher" as const };
const upload = { bytes: Buffer.from("synthetic"), mimeType: "image/jpeg" };
const input = { type: "STUDENT_STATUS" as const, clientRequestId: requestId, file: upload };

describe("teacher verification submission service", () => {
  it("allows only an ACTIVE TEACHER whose TeacherProfile belongs to the caller", async () => {
    const { service, repository, storage } = setup();
    await expect(service.submit(teacher, input)).resolves.toMatchObject({
      id: verificationId,
      type: "STUDENT_STATUS",
      status: "PENDING",
    });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ accountId, teacherProfileId: profileId }));
    expect(storage.write).toHaveBeenCalledOnce();

    for (const applicant of [
      { accountId, role: "PARENT", status: "ACTIVE", teacherProfileId: profileId },
      { accountId, role: "TEACHER", status: "SUSPENDED", teacherProfileId: profileId },
      { accountId, role: "TEACHER", status: "ACTIVE", teacherProfileId: null },
    ] as const) {
      const denied = setup({ getApplicant: vi.fn().mockResolvedValue(applicant) });
      await expect(denied.service.submit(teacher, { ...input, clientRequestId: crypto.randomUUID() }))
        .rejects.toBeInstanceOf(VerificationWorkflowError);
      expect(denied.storage.write).not.toHaveBeenCalled();
    }

    const wrongRealm = setup();
    await expect(wrongRealm.service.submit({ id: accountId, role: "parent" }, input))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(wrongRealm.repository.getApplicant).not.toHaveBeenCalled();
  });

  it.each(["STUDENT_STATUS", "EDUCATION", "TEACHER_QUALIFICATION"] as const)(
    "accepts the allowlisted %s verification type",
    async (type) => {
      const { service } = setup();
      await expect(service.submit(teacher, { ...input, type })).resolves.toMatchObject({ type });
    },
  );

  it("rejects unknown types before storing evidence", async () => {
    const { service, storage } = setup();
    await expect(service.submit(teacher, { ...input, type: "IDENTITY_CARD" } as never))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("allows at most one PENDING submission per type but allows resubmission after REJECTED", async () => {
    const pending = record();
    const blocked = setup({ findPendingByType: vi.fn().mockResolvedValue(pending) });
    await expect(blocked.service.submit(teacher, input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(blocked.storage.remove).toHaveBeenCalledWith(evidence.key);

    const rejected = setup({ findPendingByType: vi.fn().mockResolvedValue(null) });
    await expect(rejected.service.submit(teacher, input)).resolves.toMatchObject({ status: "PENDING" });
  });

  it("replays the same client request and rejects a changed type or file", async () => {
    const same = record();
    const replay = setup({ findByClientRequestId: vi.fn().mockResolvedValue(same) });
    await expect(replay.service.submit(teacher, input)).resolves.toEqual({
      id: verificationId,
      type: "STUDENT_STATUS",
      status: "PENDING",
      submittedAt: submittedAt.toISOString(),
      reviewedAt: null,
      expiresAt: null,
      reviewNote: null,
    });
    expect(replay.repository.create).not.toHaveBeenCalled();
    expect(replay.storage.remove).toHaveBeenCalledWith(evidence.key);

    for (const existing of [
      record({ type: "EDUCATION" }),
      record({ evidence: { ...evidence, sha256: "c".repeat(64) } }),
    ]) {
      const conflict = setup({ findByClientRequestId: vi.fn().mockResolvedValue(existing) });
      await expect(conflict.service.submit(teacher, input)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(conflict.storage.remove).toHaveBeenCalledWith(evidence.key);
    }
  });

  it("returns safe DTOs that never expose account IDs, profile IDs, request IDs, evidence, keys, or paths", async () => {
    const existing = record({ status: "REJECTED", reviewNote: "图片内容不清晰", reviewedAt: submittedAt });
    const { service } = setup({ listByAccount: vi.fn().mockResolvedValue([existing]) });
    const items = await service.list(teacher);
    expect(items).toEqual([{
      id: verificationId,
      type: "STUDENT_STATUS",
      status: "REJECTED",
      submittedAt: submittedAt.toISOString(),
      reviewedAt: submittedAt.toISOString(),
      expiresAt: null,
      reviewNote: "图片内容不清晰",
    }]);
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain(accountId);
    expect(serialized).not.toContain(profileId);
    expect(serialized).not.toContain(requestId);
    expect(serialized).not.toMatch(/evidence|key|path|sha256|byteSize/i);
  });

  it("cleans up the file after a repository failure", async () => {
    const { service, storage } = setup({ create: vi.fn().mockRejectedValue(new Error("synthetic DB failure")) });
    await expect(service.submit(teacher, input)).rejects.toThrow("synthetic DB failure");
    expect(storage.remove).toHaveBeenCalledWith(evidence.key);
  });

  it("reconciles commit-unknown by retaining evidence referenced by the committed row", async () => {
    const current = setup();
    const baseTransaction = current.repository.transaction.bind(current.repository);
    let loseAcknowledgement = true;
    current.repository.transaction = async (operation) => {
      const result = await baseTransaction(operation);
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        throw new Error("connection lost after COMMIT");
      }
      return result;
    };
    await expect(current.service.submit(teacher, input)).resolves.toMatchObject({ id: verificationId });
    expect(current.storage.remove).not.toHaveBeenCalled();
  });

  it("preserves evidence and returns an observable error when reconciliation is unavailable", async () => {
    const current = setup({ transaction: vi.fn().mockRejectedValue(new Error("database unavailable")) });
    await expect(current.service.submit(teacher, input)).rejects.toMatchObject({ code: "COMMIT_UNKNOWN" });
    expect(current.storage.remove).not.toHaveBeenCalled();
  });

  it("does not hide cleanup failures after a confirmed conflict", async () => {
    const current = setup({ findPendingByType: vi.fn().mockResolvedValue(record()) });
    vi.mocked(current.storage.remove).mockRejectedValue(new Error("synthetic unlink failure"));
    let thrown: unknown;
    try {
      await current.service.submit(teacher, input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EvidencePersistenceError);
    expect(thrown).toMatchObject({ code: "CLEANUP_FAILED", cause: expect.any(AggregateError) });
  });

  it("is disabled when no private adapter is available in production", async () => {
    const { service, storage, repository } = setup({}, false);
    await expect(service.submit(teacher, input)).rejects.toMatchObject({ code: "DISABLED" });
    expect(storage.write).not.toHaveBeenCalled();
    expect(repository.getApplicant).not.toHaveBeenCalled();
  });
});
