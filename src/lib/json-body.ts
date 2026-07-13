export const MAX_JSON_BODY_BYTES = 16 * 1024;

export type JsonBodyErrorCode = "invalid" | "too_large";

export class JsonBodyError extends Error {
  constructor(readonly code: JsonBodyErrorCode, message: string) {
    super(message);
    this.name = "JsonBodyError";
  }
}

export async function readLimitedJson(request: Request, maximumBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new JsonBodyError("invalid", "请提交 JSON 内容");

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) throw new JsonBodyError("invalid", "Content-Length 格式不正确");
    if (Number(contentLength) > maximumBytes) throw new JsonBodyError("too_large", "请求内容过大");
  }
  if (!request.body) throw new JsonBodyError("invalid", "JSON 内容格式不正确");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let aborted = request.signal.aborted;
  const cancelOnAbort = () => {
    aborted = true;
    void reader.cancel(request.signal.reason ?? "请求已取消").catch(() => undefined);
  };
  request.signal.addEventListener("abort", cancelOnAbort, { once: true });
  if (aborted) cancelOnAbort();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("请求内容过大");
        throw new JsonBodyError("too_large", "请求内容过大");
      }
      chunks.push(value);
    }
    if (aborted) throw new JsonBodyError("invalid", "请求已取消");
  } catch (error) {
    if (aborted && !(error instanceof JsonBodyError)) {
      throw new JsonBodyError("invalid", "请求已取消");
    }
    throw error;
  } finally {
    request.signal.removeEventListener("abort", cancelOnAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new JsonBodyError("invalid", "JSON 内容格式不正确");
  }
}
