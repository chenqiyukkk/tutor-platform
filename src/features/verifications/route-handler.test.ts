// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "@/features/auth/service";

import { EvidencePersistenceError, StorageError } from "./storage";
import { createVerificationHandlers, MAX_VERIFICATION_MULTIPART_BYTES } from "./route-handler";
import { VerificationWorkflowError } from "./service";

const accountId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const verificationId = "33333333-3333-4333-8333-333333333333";
const dto = {
  id: verificationId,
  type: "STUDENT_STATUS",
  status: "PENDING" as const,
  submittedAt: "2026-07-14T01:00:00.000Z",
  reviewedAt: null,
  expiresAt: null,
  reviewNote: null,
};

function multipartRequest(path = "/api/teacher/verifications", mutate?: (form: FormData) => void) {
  const form = new FormData();
  form.set("type", "STUDENT_STATUS");
  form.set("clientRequestId", requestId);
  form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "student.jpg", { type: "image/jpeg" }));
  mutate?.(form);
  return new Request(`http://test${path}`, {
    method: "POST",
    headers: {
      cookie: "tutor_teacher_session=teacher-token",
      "content-length": "1024",
    },
    body: form,
  });
}

function setup(uploadEnabled = true) {
  const authenticate = vi.fn(async (_role: "teacher", token: string | undefined) => {
    if (!token) throw new AuthError("UNAUTHORIZED", "private auth detail");
    return {
      id: accountId,
      role: "teacher" as const,
      status: "active" as const,
      username: "private-teacher",
      email: "private@example.test",
    };
  });
  const verificationService = {
    list: vi.fn().mockResolvedValue([dto]),
    submit: vi.fn().mockResolvedValue(dto),
  };
  return {
    authenticate,
    verificationService,
    handlers: createVerificationHandlers({ authenticate, verificationService, uploadEnabled }),
  };
}

describe("teacher verification routes", () => {
  it("lists only the authenticated teacher's safe records with no-store", async () => {
    const { handlers, authenticate, verificationService } = setup();
    const response = await handlers.GET(new Request("http://test/api/teacher/verifications", {
      headers: { cookie: "tutor_teacher_session=teacher-token; tutor_parent_session=parent-token" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ verifications: [dto], uploadEnabled: true });
    expect(authenticate).toHaveBeenCalledWith("teacher", "teacher-token");
    expect(verificationService.list).toHaveBeenCalledWith({ id: accountId, role: "teacher" });
  });

  it("parses exactly one strict multipart submission and passes only server-derived actor data", async () => {
    const { handlers, verificationService } = setup();
    const response = await handlers.POST(multipartRequest());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ verification: dto });
    expect(verificationService.submit).toHaveBeenCalledWith(
      { id: accountId, role: "teacher" },
      {
        type: "STUDENT_STATUS",
        clientRequestId: requestId,
        file: { bytes: expect.any(Uint8Array), mimeType: "image/jpeg" },
      },
    );
    const serializedCall = JSON.stringify(verificationService.submit.mock.calls[0]);
    expect(serializedCall).not.toMatch(/username|email|path|key/i);
  });

  it("returns DISABLED after authentication without reading the multipart body", async () => {
    const { handlers, authenticate, verificationService } = setup(false);
    const request = multipartRequest();
    const reader = vi.spyOn(request.body!, "getReader");
    const response = await handlers.POST(request);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(authenticate).toHaveBeenCalledWith("teacher", "teacher-token");
    expect(reader).not.toHaveBeenCalled();
    expect(verificationService.submit).not.toHaveBeenCalled();
  });

  it.each([
    "tutor_teacher_session=one; tutor_teacher_session=two",
    "tutor_teacher_session=%E0%A4%A",
    "",
  ])("rejects missing, duplicate, or malformed teacher cookies", async (cookie) => {
    const { handlers, verificationService } = setup();
    const request = multipartRequest();
    request.headers.set("cookie", cookie);
    const response = await handlers.POST(request);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(verificationService.submit).not.toHaveBeenCalled();
  });

  it("rejects every query parameter on GET and POST", async () => {
    const { handlers, verificationService } = setup();
    expect((await handlers.GET(new Request(
      "http://test/api/teacher/verifications?accountId=private",
      { headers: { cookie: "tutor_teacher_session=token" } },
    ))).status).toBe(400);
    expect((await handlers.POST(multipartRequest("/api/teacher/verifications?type=EDUCATION"))).status).toBe(400);
    expect(verificationService.list).not.toHaveBeenCalled();
    expect(verificationService.submit).not.toHaveBeenCalled();
  });

  it("rejects unsupported, missing, malformed, and oversized multipart bodies before the service", async () => {
    const { handlers, verificationService } = setup();
    const unsupported = await handlers.POST(new Request("http://test/api/teacher/verifications", {
      method: "POST",
      headers: { cookie: "tutor_teacher_session=token", "content-type": "application/json", "content-length": "2" },
      body: "{}",
    }));
    expect(unsupported.status).toBe(415);

    const missingLength = multipartRequest();
    missingLength.headers.delete("content-length");
    expect((await handlers.POST(missingLength)).status).toBe(400);

    const malformedLength = multipartRequest();
    malformedLength.headers.set("content-length", "1e3");
    expect((await handlers.POST(malformedLength)).status).toBe(400);

    const oversized = multipartRequest();
    oversized.headers.set("content-length", String(MAX_VERIFICATION_MULTIPART_BYTES + 1));
    expect((await handlers.POST(oversized)).status).toBe(413);
    expect(verificationService.submit).not.toHaveBeenCalled();
  });

  it("enforces the actual multipart stream cap even when Content-Length lies", async () => {
    const { handlers, verificationService } = setup();
    const response = await handlers.POST(new Request("http://test/api/teacher/verifications", {
      method: "POST",
      headers: {
        cookie: "tutor_teacher_session=token",
        "content-type": "multipart/form-data; boundary=x",
        "content-length": "1",
      },
      body: new Uint8Array(MAX_VERIFICATION_MULTIPART_BYTES + 1),
    }));
    expect(response.status).toBe(413);
    expect(verificationService.submit).not.toHaveBeenCalled();
  });

  it("rejects an over-limit File and a non-allowlisted MIME before the service", async () => {
    for (const [request, expectedStatus] of [
      [multipartRequest(undefined, (form) => form.set("file", new File(
        [new Uint8Array(5 * 1024 * 1024 + 1)], "oversized.png", { type: "image/png" },
      ))), 413],
      [multipartRequest(undefined, (form) => form.set("file", new File(
        [new Uint8Array([0x47, 0x49, 0x46])], "image.gif", { type: "image/gif" },
      ))), 400],
    ] as const) {
      const { handlers, verificationService } = setup();
      const response = await handlers.POST(request);
      expect(response.status).toBe(expectedStatus);
      expect(verificationService.submit).not.toHaveBeenCalled();
    }
  });

  it("rejects suspended/nonteacher sessions and a teacher without a profile on GET", async () => {
    for (const account of [
      { role: "teacher", status: "suspended" },
      { role: "parent", status: "active" },
    ] as const) {
      const current = setup();
      current.authenticate.mockResolvedValueOnce({
        id: accountId,
        role: account.role,
        status: account.status,
        username: "private",
        email: "private@example.test",
      } as never);
      const response = await current.handlers.GET(new Request("http://test/api/teacher/verifications", {
        headers: { cookie: "tutor_teacher_session=token" },
      }));
      expect(response.status).toBe(401);
      expect(current.verificationService.list).not.toHaveBeenCalled();
    }

    const noProfile = setup();
    noProfile.verificationService.list.mockRejectedValueOnce(
      new VerificationWorkflowError("PROFILE_REQUIRED", "private profile detail"),
    );
    const response = await noProfile.handlers.GET(new Request("http://test/api/teacher/verifications", {
      headers: { cookie: "tutor_teacher_session=token" },
    }));
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects duplicate, missing, non-file, and client-controlled fields", async () => {
    const cases = [
      multipartRequest(undefined, (form) => form.append("type", "EDUCATION")),
      multipartRequest(undefined, (form) => form.delete("clientRequestId")),
      multipartRequest(undefined, (form) => form.set("file", "not-a-file")),
      multipartRequest(undefined, (form) => form.set("accountId", accountId)),
    ];
    for (const request of cases) {
      const { handlers, verificationService } = setup();
      const response = await handlers.POST(request);
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(verificationService.submit).not.toHaveBeenCalled();
    }
  });

  it.each([
    [new AuthError("UNAUTHORIZED", `private ${accountId}`), 401, "UNAUTHORIZED"],
    [new VerificationWorkflowError("UNAUTHORIZED", `private ${accountId}`), 401, "UNAUTHORIZED"],
    [new VerificationWorkflowError("FORBIDDEN", `private ${accountId}`), 403, "FORBIDDEN"],
    [new VerificationWorkflowError("PROFILE_REQUIRED", `private ${accountId}`), 409, "PROFILE_REQUIRED"],
    [new VerificationWorkflowError("INVALID_INPUT", `private ${accountId}`), 400, "INVALID_INPUT"],
    [new VerificationWorkflowError("CONFLICT", `private ${accountId}`), 409, "CONFLICT"],
    [new VerificationWorkflowError("DISABLED", `private ${accountId}`), 503, "DISABLED"],
    [new StorageError("TOO_LARGE", `private path ${accountId}`), 413, "PAYLOAD_TOO_LARGE"],
    [new StorageError("INVALID_IMAGE", `private path ${accountId}`), 400, "INVALID_INPUT"],
    [new StorageError("DISABLED", `private path ${accountId}`), 503, "DISABLED"],
  ] as const)("maps known failures to generic no-store errors", async (error, status, code) => {
    const { handlers, verificationService } = setup();
    verificationService.submit.mockRejectedValueOnce(error);
    const response = await handlers.POST(multipartRequest());
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.code).toBe(code);
    expect(JSON.stringify(body)).not.toContain(accountId);
    expect(JSON.stringify(body)).not.toMatch(/private path|prisma|database/i);
  });

  it("hides unknown database and filesystem failures behind a generic 500", async () => {
    const { handlers, verificationService } = setup();
    verificationService.submit.mockRejectedValueOnce(new Error(`Prisma key C:\\private\\${accountId}`));
    const response = await handlers.POST(multipartRequest());
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ code: "INTERNAL_ERROR", error: "服务暂时不可用" });
  });

  it("logs only the stable reconciliation code and returns a generic observable 500", async () => {
    const { handlers, verificationService } = setup();
    const monitor = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      verificationService.submit.mockRejectedValueOnce(new EvidencePersistenceError(
        "COMMIT_UNKNOWN",
        `private ${accountId}`,
        { cause: new AggregateError([new Error(`private path ${accountId}`)]) },
      ));
      const response = await handlers.POST(multipartRequest());
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ code: "INTERNAL_ERROR", error: "服务暂时不可用" });
      expect(monitor).toHaveBeenCalledWith("[verification-evidence]", "COMMIT_UNKNOWN");
      expect(JSON.stringify(monitor.mock.calls)).not.toContain(accountId);
    } finally {
      monitor.mockRestore();
    }
  });

  it("maps private filesystem write failures to a monitored generic 500", async () => {
    const { handlers, verificationService } = setup();
    const monitor = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      verificationService.submit.mockRejectedValueOnce(new StorageError(
        "WRITE_FAILED",
        `private path ${accountId}`,
        { cause: new Error(`disk path ${accountId}`) },
      ));
      const response = await handlers.POST(multipartRequest());
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ code: "INTERNAL_ERROR", error: "服务暂时不可用" });
      expect(monitor).toHaveBeenCalledWith("[verification-evidence]", "WRITE_FAILED");
      expect(JSON.stringify(monitor.mock.calls)).not.toContain(accountId);
    } finally {
      monitor.mockRestore();
    }
  });
});
