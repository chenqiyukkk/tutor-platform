export const MAX_JSON_BODY_BYTES = 16 * 1024;

export class JsonBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonBodyError";
  }
}

export async function readLimitedJson(request: Request, maximumBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new JsonBodyError("请提交 JSON 内容");

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength) || Number(contentLength) > maximumBytes) {
      throw new JsonBodyError("请求内容过大");
    }
  }
  if (!request.body) throw new JsonBodyError("JSON 内容格式不正确");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("请求内容过大");
        throw new JsonBodyError("请求内容过大");
      }
      chunks.push(value);
    }
  } finally {
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
    throw new JsonBodyError("JSON 内容格式不正确");
  }
}
