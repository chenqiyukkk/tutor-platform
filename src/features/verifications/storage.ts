import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { constants, existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import sharp, { type Metadata } from "sharp";

import { privateEvidenceSchema } from "./schema";

export const MAX_VERIFICATION_UPLOAD_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_VERIFICATION_PIXELS = 20_000_000;

export type PrivateEvidence = {
  provider: "local-private";
  key: string;
  mimeType: "image/jpeg" | "image/png";
  byteSize: number;
  sha256: string;
};

export type EvidenceUpload = {
  bytes: Uint8Array;
  mimeType: string;
};

export type StorageErrorCode =
  | "DISABLED"
  | "TOO_LARGE"
  | "INVALID_IMAGE"
  | "INVALID_KEY"
  | "NOT_FOUND"
  | "WRITE_FAILED";

export class StorageError extends Error {
  constructor(readonly code: StorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StorageError";
  }
}

export type EvidencePersistenceErrorCode = "COMMIT_UNKNOWN" | "CLEANUP_FAILED";

export class EvidencePersistenceError extends Error {
  constructor(
    readonly code: EvidencePersistenceErrorCode,
    message: string,
    options: { cause: AggregateError },
  ) {
    super(message, options);
    this.name = "EvidencePersistenceError";
  }
}

export interface PrivateEvidenceStorage {
  readonly enabled: boolean;
  write(upload: EvidenceUpload): Promise<PrivateEvidence>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

function detectFormat(bytes: Uint8Array): "jpeg" | "png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "png";
  return null;
}

function pngDeclaresAnimation(bytes: Uint8Array) {
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const length = (
      bytes[offset] * 0x1000000
      + bytes[offset + 1] * 0x10000
      + bytes[offset + 2] * 0x100
      + bytes[offset + 3]
    ) >>> 0;
    if (offset + 12 + length > bytes.byteLength) return false;
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (type === "acTL") return true;
    if (type === "IEND") return false;
    offset += 12 + length;
  }
  return false;
}

function safePath(rootDir: string, key: string) {
  if (!/^[a-f0-9]{64}\.(?:jpg|png)$/.test(key)) {
    throw new StorageError("INVALID_KEY", "认证材料标识无效");
  }
  const root = resolve(/* turbopackIgnore: true */ rootDir);
  const target = resolve(/* turbopackIgnore: true */ root, key);
  const child = relative(root, target);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw new StorageError("INVALID_KEY", "认证材料标识无效");
  }
  return target;
}

function isInside(parent: string, target: string) {
  const child = relative(
    resolve(/* turbopackIgnore: true */ parent),
    resolve(/* turbopackIgnore: true */ target),
  );
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function resolveExistingPath(target: string) {
  const suffix: string[] = [];
  let existing = resolve(/* turbopackIgnore: true */ target);
  while (!existsSync(/* turbopackIgnore: true */ existing)) {
    const parent = dirname(existing);
    if (parent === existing) return resolve(/* turbopackIgnore: true */ target);
    suffix.unshift(existing.slice(parent.length).replace(/^[/\\]+/, ""));
    existing = parent;
  }
  // lstat is intentional: realpath then resolves symlinks, junctions and other
  // reparse points from the nearest existing ancestor.
  lstatSync(/* turbopackIgnore: true */ existing);
  return resolve(
    /* turbopackIgnore: true */ realpathSync.native(/* turbopackIgnore: true */ existing),
    ...suffix,
  );
}

function findGitMetadata(startDir: string) {
  let current = resolve(/* turbopackIgnore: true */ startDir);
  while (true) {
    const marker = join(/* turbopackIgnore: true */ current, ".git");
    if (existsSync(/* turbopackIgnore: true */ marker)) {
      const stat = lstatSync(/* turbopackIgnore: true */ marker);
      let gitDir = marker;
      if (stat.isFile()) {
        const value = readFileSync(/* turbopackIgnore: true */ marker, "utf8").trim();
        if (!value.startsWith("gitdir:")) break;
        gitDir = resolve(/* turbopackIgnore: true */ current, value.slice("gitdir:".length).trim());
      }
      let commonDir = gitDir;
      const commonMarker = join(/* turbopackIgnore: true */ gitDir, "commondir");
      if (existsSync(/* turbopackIgnore: true */ commonMarker)) {
        commonDir = resolve(
          /* turbopackIgnore: true */ gitDir,
          readFileSync(/* turbopackIgnore: true */ commonMarker, "utf8").trim(),
        );
      }
      return { worktreeRoot: current, gitDir, commonDir };
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function forbiddenRoots(startDir: string) {
  const roots = new Set([resolve(/* turbopackIgnore: true */ startDir)]);
  const metadata = findGitMetadata(startDir);
  if (metadata) {
    roots.add(resolve(/* turbopackIgnore: true */ metadata.worktreeRoot));
    roots.add(resolve(/* turbopackIgnore: true */ metadata.gitDir));
    roots.add(resolve(/* turbopackIgnore: true */ metadata.commonDir));
    // The common directory is normally <main-worktree>/.git. Its parent is
    // another Git worktree and must not become a private upload directory.
    if (
      resolve(/* turbopackIgnore: true */ metadata.commonDir)
      === resolve(/* turbopackIgnore: true */ dirname(metadata.commonDir), ".git")
    ) {
      roots.add(resolve(/* turbopackIgnore: true */ dirname(metadata.commonDir)));
    }
  }
  return [...roots].flatMap((root) => [root, resolveExistingPath(root)]);
}

function isSafePrivateRoot(root: string, startDir = process.cwd()) {
  if (!root || !isAbsolute(root)) return false;
  try {
    const lexical = resolve(/* turbopackIgnore: true */ root);
    const physical = resolveExistingPath(root);
    return forbiddenRoots(startDir).every((forbidden) =>
      !isInside(forbidden, lexical) && !isInside(forbidden, physical));
  } catch {
    return false;
  }
}

function unavailable(): never {
  throw new StorageError("DISABLED", "认证材料上传暂未开放");
}

export function createLocalPrivateEvidenceStorage({
  rootDir,
  nodeEnv = process.env.NODE_ENV,
  maxPixels = DEFAULT_MAX_VERIFICATION_PIXELS,
  randomKey = () => randomBytes(32).toString("hex"),
  fileOperations,
}: {
  rootDir?: string;
  nodeEnv?: string;
  maxPixels?: number;
  randomKey?: () => string;
  fileOperations?: {
    write?: (path: string, bytes: Uint8Array, options: { flag: "wx"; mode: number }) => Promise<void>;
    remove?: (path: string, options: { force: true }) => Promise<void>;
  };
}): PrivateEvidenceStorage {
  const root = rootDir?.trim() ?? "";
  const enabled = nodeEnv !== "production" && isSafePrivateRoot(root);

  function assertAvailable() {
    if (!enabled || !isSafePrivateRoot(root)) unavailable();
  }

  const writeLeaf = fileOperations?.write
    ?? ((path, bytes, options) => writeFile(/* turbopackIgnore: true */ path, bytes, options));
  const removeLeaf = fileOperations?.remove
    ?? ((path, options) => rm(/* turbopackIgnore: true */ path, options));

  async function regularLeaf(key: string) {
    assertAvailable();
    const target = safePath(root, key);
    try {
      const leaf = await lstat(/* turbopackIgnore: true */ target);
      if (!leaf.isFile() || leaf.isSymbolicLink()) {
        throw new StorageError("INVALID_KEY", "认证材料不是普通私有文件");
      }
      const physicalRoot = resolveExistingPath(root);
      const physicalLeaf = await realpath(/* turbopackIgnore: true */ target);
      if (!isInside(physicalRoot, physicalLeaf)) {
        throw new StorageError("INVALID_KEY", "认证材料超出私有目录");
      }
      return { target, device: leaf.dev, inode: leaf.ino };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        throw new StorageError("NOT_FOUND", "认证材料不存在");
      }
      throw error;
    }
  }

  return {
    enabled,

    async write({ bytes, mimeType }) {
      assertAvailable();
      if (bytes.byteLength > MAX_VERIFICATION_UPLOAD_BYTES) {
        throw new StorageError("TOO_LARGE", "认证图片不得超过 5 MiB");
      }
      const format = detectFormat(bytes);
      const expectedMimeType = format === "jpeg" ? "image/jpeg" : format === "png" ? "image/png" : null;
      if (!format || mimeType !== expectedMimeType) {
        throw new StorageError("INVALID_IMAGE", "只支持有效的 JPEG 或 PNG 图片");
      }
      if (format === "png" && pngDeclaresAnimation(bytes)) {
        throw new StorageError("INVALID_IMAGE", "不支持动画或多页认证图片");
      }

      let metadata: Metadata;
      let output: Buffer;
      try {
        const decoder = sharp(bytes, { failOn: "error", limitInputPixels: maxPixels });
        metadata = await decoder.metadata();
        if (
          metadata.format !== format
          || !metadata.width || !metadata.height
          || metadata.width * metadata.height > maxPixels
          || (metadata.pages ?? 1) !== 1
        ) {
          throw new Error("invalid image geometry");
        }
        const normalized = sharp(bytes, { failOn: "error", limitInputPixels: maxPixels }).rotate();
        output = format === "jpeg"
          ? await normalized.jpeg({ quality: 90, progressive: false }).toBuffer()
          : await normalized.png({ compressionLevel: 9, progressive: false }).toBuffer();
      } catch {
        throw new StorageError("INVALID_IMAGE", "认证图片无法安全解码");
      }
      if (output.byteLength > MAX_VERIFICATION_UPLOAD_BYTES) {
        throw new StorageError("TOO_LARGE", "处理后的认证图片过大");
      }

      const opaque = randomKey();
      if (!/^[a-f0-9]{64}$/.test(opaque)) {
        throw new StorageError("INVALID_KEY", "无法生成安全的认证材料标识");
      }
      const key = `${opaque}.${format === "jpeg" ? "jpg" : "png"}`;
      const evidence: PrivateEvidence = {
        provider: "local-private",
        key,
        mimeType: expectedMimeType,
        byteSize: output.byteLength,
        sha256: createHash("sha256").update(output).digest("hex"),
      };
      privateEvidenceSchema.parse(evidence);
      await mkdir(/* turbopackIgnore: true */ root, { recursive: true, mode: 0o700 });
      // POSIX mode bits do not configure Windows ACLs. Operators must grant
      // this directory only to the application identity on Windows.
      if (process.platform !== "win32") await chmod(/* turbopackIgnore: true */ root, 0o700);
      assertAvailable();
      const target = safePath(root, key);
      try {
        // wx prevents overwriting a raced leaf. The root is canonicalized
        // immediately before this call; portable openat is unavailable on
        // Windows, so every later I/O revalidates the root and leaf again.
        await writeLeaf(target, output, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
          throw new StorageError("INVALID_KEY", "认证材料标识发生冲突");
        }
        try {
          await removeLeaf(target, { force: true });
        } catch (cleanupError) {
          throw new EvidencePersistenceError(
            "CLEANUP_FAILED",
            "认证材料写入失败且部分文件无法清理",
            { cause: new AggregateError([error, cleanupError], "verification partial write cleanup failed") },
          );
        }
        throw new StorageError(
          "WRITE_FAILED",
          "认证材料无法写入私有存储",
          { cause: error instanceof Error ? error : new Error("unknown private storage write failure") },
        );
      }
      return evidence;
    },

    async read(key) {
      const checked = await regularLeaf(key);
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
        handle = await open(/* turbopackIgnore: true */ checked.target, constants.O_RDONLY | noFollow);
        const opened = await handle.stat();
        assertAvailable();
        if (
          !opened.isFile()
          || opened.dev !== checked.device
          || opened.ino !== checked.inode
          || !isInside(
            resolveExistingPath(root),
            await realpath(/* turbopackIgnore: true */ checked.target),
          )
        ) {
          throw new StorageError("INVALID_KEY", "认证材料在读取前发生变化");
        }
        return await handle.readFile();
      } catch (error) {
        if (error instanceof StorageError) throw error;
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          throw new StorageError("NOT_FOUND", "认证材料不存在");
        }
        if (error && typeof error === "object" && "code" in error && ["ELOOP", "EISDIR", "EPERM"].includes(String(error.code))) {
          throw new StorageError("INVALID_KEY", "认证材料不是普通私有文件");
        }
        throw error;
      } finally {
        if (handle) await handle.close();
      }
    },

    async remove(key) {
      const checked = await regularLeaf(key);
      assertAvailable();
      const current = await lstat(/* turbopackIgnore: true */ checked.target);
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== checked.device || current.ino !== checked.inode) {
        throw new StorageError("INVALID_KEY", "认证材料在删除前发生变化");
      }
      // rm/unlink removes the leaf itself and does not traverse a leaf symlink;
      // the second identity check narrows the remaining portable unlink race.
      await removeLeaf(checked.target, { force: true });
    },
  };
}

export async function storePrivateEvidence<T>(
  storage: PrivateEvidenceStorage,
  upload: EvidenceUpload,
  persist: (evidence: PrivateEvidence) => Promise<T>,
  reconcile: (evidence: PrivateEvidence, persistenceError: unknown) => Promise<
    | { state: "committed"; value: T; referencedKey: string }
    | { state: "not-committed" }
    | { state: "conflict"; error: Error }
  >,
) {
  const evidence = await storage.write(upload);
  try {
    return await persist(evidence);
  } catch (persistenceError) {
    let resolution: Awaited<ReturnType<typeof reconcile>>;
    try {
      resolution = await reconcile(evidence, persistenceError);
    } catch (reconciliationError) {
      throw new EvidencePersistenceError(
        "COMMIT_UNKNOWN",
        "认证材料提交结果未知，已保留材料等待核对",
        { cause: new AggregateError([persistenceError, reconciliationError], "verification persistence reconciliation failed") },
      );
    }

    const cleanup = async (primaryError: unknown) => {
      try {
        await storage.remove(evidence.key);
      } catch (cleanupError) {
        const causes = persistenceError === primaryError
          ? [persistenceError, cleanupError]
          : [persistenceError, primaryError, cleanupError];
        throw new EvidencePersistenceError(
          "CLEANUP_FAILED",
          "认证材料清理失败，需要人工核对",
          { cause: new AggregateError(causes, "verification evidence cleanup failed") },
        );
      }
    };

    if (resolution.state === "committed") {
      if (resolution.referencedKey !== evidence.key) await cleanup(persistenceError);
      return resolution.value;
    }
    const finalError = resolution.state === "conflict" ? resolution.error : persistenceError;
    await cleanup(finalError);
    throw finalError;
  }
}
