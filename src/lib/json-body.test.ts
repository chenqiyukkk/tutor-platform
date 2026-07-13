import { describe, expect, it, vi } from "vitest";

import { JsonBodyError, readLimitedJson } from "./json-body";

function streamingRequest(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  return new Request("http://test/body", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("bounded JSON reader", () => {
  it("classifies oversized and malformed bodies separately", async () => {
    await expect(readLimitedJson(new Request("http://test/body", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "20000" },
      body: "{}",
    }))).rejects.toMatchObject({ code: "too_large" } satisfies Partial<JsonBodyError>);
    await expect(readLimitedJson(new Request("http://test/body", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad json",
    }))).rejects.toMatchObject({ code: "invalid" } satisfies Partial<JsonBodyError>);
  });

  it("cancels an in-flight reader when the request signal aborts", async () => {
    const cancel = vi.fn();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { source = controller; },
      cancel,
    });
    const abort = new AbortController();
    const reading = readLimitedJson(streamingRequest(body, abort.signal));
    abort.abort();
    const fallback = setTimeout(() => {
      try { source.close(); } catch { /* already canceled */ }
    }, 100);
    try {
      await expect(reading).rejects.toMatchObject({ code: "invalid" } satisfies Partial<JsonBodyError>);
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      clearTimeout(fallback);
    }
  });
});
