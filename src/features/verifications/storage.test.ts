// @vitest-environment node

import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MAX_VERIFICATION_UPLOAD_BYTES,
  EvidencePersistenceError,
  StorageError,
  createLocalPrivateEvidenceStorage,
  storePrivateEvidence,
} from "./storage";

const roots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "tutor-verification-"));
  roots.push(root);
  return root;
}

async function image(format: "jpeg" | "png", width = 16, height = 12, metadata = false) {
  let pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 18, g: 52, b: 86 } },
  });
  if (metadata) {
    pipeline = pipeline.withMetadata({
      orientation: 6,
      exif: { IFD0: { Artist: "private-location-owner" } },
    }).withIccProfile("srgb").withXmp(`
      <x:xmpmeta xmlns:x="adobe:ns:meta/">
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
          <rdf:Description privateOwner="sensitive-xmp-value" />
        </rdf:RDF>
      </x:xmpmeta>
    `);
  }
  return format === "jpeg" ? pipeline.jpeg().toBuffer() : pipeline.png().toBuffer();
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array) {
  const name = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.byteLength);
  result.writeUInt32BE(data.byteLength, 0);
  name.copy(result, 4);
  Buffer.from(data).copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, Buffer.from(data)])), 8 + data.byteLength);
  return result;
}

function animatedPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(2, 0); actl.writeUInt32BE(0, 4);
  const frame = (sequence: number) => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    data.writeUInt32BE(1, 4); data.writeUInt32BE(1, 8);
    data.writeUInt16BE(1, 20); data.writeUInt16BE(10, 22);
    return pngChunk("fcTL", data);
  };
  const first = deflateSync(Buffer.from([0, 255, 0, 0, 255]));
  const secondPixels = deflateSync(Buffer.from([0, 0, 0, 255, 255]));
  const second = Buffer.alloc(4 + secondPixels.byteLength);
  second.writeUInt32BE(2, 0); secondPixels.copy(second, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr), pngChunk("acTL", actl), frame(0), pngChunk("IDAT", first),
    frame(1), pngChunk("fdAT", second), pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function currentGitRoots() {
  const markerPath = join(process.cwd(), ".git");
  const markerStat = await lstat(markerPath);
  let gitDir = markerPath;
  if (markerStat.isFile()) {
    const marker = (await readFile(markerPath, "utf8")).trim();
    if (!marker.startsWith("gitdir:")) throw new Error("invalid linked-worktree .git marker");
    gitDir = resolve(process.cwd(), marker.slice("gitdir:".length).trim());
  }
  let commonDir = gitDir;
  try {
    commonDir = resolve(gitDir, (await readFile(join(gitDir, "commondir"), "utf8")).trim());
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  return { gitDir, commonDir, mainWorktree: dirname(commonDir) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local private verification evidence storage", () => {
  it.each([
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
  ] as const)("decodes and re-encodes allowlisted %s uploads", async (format, mimeType) => {
    const storage = createLocalPrivateEvidenceStorage({ rootDir: await temporaryRoot(), nodeEnv: "test" });
    const evidence = await storage.write({ bytes: await image(format), mimeType });

    expect(evidence).toEqual({
      provider: "local-private",
      key: expect.stringMatching(/^[a-f0-9]{64}\.(?:jpe?g|png)$/),
      mimeType,
      byteSize: expect.any(Number),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(await sharp(await storage.read(evidence.key)).metadata()).toMatchObject({
      format,
      width: 16,
      height: 12,
    });
  });

  it("rejects oversized uploads before decode", async () => {
    const storage = createLocalPrivateEvidenceStorage({ rootDir: await temporaryRoot(), nodeEnv: "test" });
    await expect(storage.write({
      bytes: Buffer.alloc(MAX_VERIFICATION_UPLOAD_BYTES + 1),
      mimeType: "image/jpeg",
    })).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it.each([
    [Buffer.from("not a jpeg"), "image/jpeg"],
    [Buffer.from("not a png"), "image/png"],
    [Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/png"],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/jpeg"],
  ] as const)("rejects wrong or mismatched magic bytes", async (bytes, mimeType) => {
    const storage = createLocalPrivateEvidenceStorage({ rootDir: await temporaryRoot(), nodeEnv: "test" });
    await expect(storage.write({ bytes, mimeType })).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });

  it("rejects decoded images above the configured pixel limit", async () => {
    const storage = createLocalPrivateEvidenceStorage({
      rootDir: await temporaryRoot(),
      nodeEnv: "test",
      maxPixels: 1_000,
    });
    await expect(storage.write({
      bytes: await image("png", 40, 30),
      mimeType: "image/png",
    })).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });

  it("rejects an actually animated multi-page PNG", async () => {
    const bytes = animatedPng();
    const animationControl = bytes.indexOf(Buffer.from("acTL", "ascii"));
    expect(animationControl).toBeGreaterThan(0);
    expect(bytes.readUInt32BE(animationControl + 4)).toBe(2);
    expect(await sharp(bytes).metadata()).toMatchObject({ format: "png" });
    const storage = createLocalPrivateEvidenceStorage({ rootDir: await temporaryRoot(), nodeEnv: "test" });
    await expect(storage.write({ bytes, mimeType: "image/png" }))
      .rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });

  it("strips EXIF and other metadata during server-side re-encoding", async () => {
    const storage = createLocalPrivateEvidenceStorage({ rootDir: await temporaryRoot(), nodeEnv: "test" });
    const source = await image("jpeg", 16, 12, true);
    const sourceMetadata = await sharp(source).metadata();
    expect(sourceMetadata.exif).toBeDefined();
    expect(sourceMetadata.icc).toBeDefined();
    expect(sourceMetadata.xmp).toBeDefined();
    expect(sourceMetadata.orientation).toBe(6);
    expect(source.toString()).toContain("private-location-owner");
    const evidence = await storage.write({ bytes: source, mimeType: "image/jpeg" });
    const metadata = await sharp(await storage.read(evidence.key)).metadata();

    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect((await storage.read(evidence.key)).toString()).not.toContain("private-location-owner");
  });

  it("generates a fresh random opaque key for identical uploads", async () => {
    const storage = createLocalPrivateEvidenceStorage({ rootDir: await temporaryRoot(), nodeEnv: "test" });
    const bytes = await image("png");
    const first = await storage.write({ bytes, mimeType: "image/png" });
    const second = await storage.write({ bytes, mimeType: "image/png" });
    expect(second.key).not.toBe(first.key);
    expect(second.sha256).toBe(first.sha256);
  });

  it("contains reads, writes, and removals inside the configured root", async () => {
    const root = await temporaryRoot();
    const outside = join(root, "..", `outside-${crypto.randomUUID()}.txt`);
    await writeFile(outside, "secret");
    try {
      const storage = createLocalPrivateEvidenceStorage({
        rootDir: root,
        nodeEnv: "test",
        randomKey: () => "../escape",
      });
      await expect(storage.write({ bytes: await image("jpeg"), mimeType: "image/jpeg" }))
        .rejects.toBeInstanceOf(StorageError);
      await expect(storage.read("../outside.txt")).rejects.toMatchObject({ code: "INVALID_KEY" });
      await expect(storage.remove("../outside.txt")).rejects.toMatchObject({ code: "INVALID_KEY" });
      await expect(readFile(outside, "utf8")).resolves.toBe("secret");
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("hard-disables local evidence storage in production", async () => {
    const storage = createLocalPrivateEvidenceStorage({ rootDir: await temporaryRoot(), nodeEnv: "production" });
    expect(storage.enabled).toBe(false);
    await expect(storage.write({ bytes: await image("jpeg"), mimeType: "image/jpeg" }))
      .rejects.toMatchObject({ code: "DISABLED" });
  });

  it("requires an absolute private upload root", async () => {
    const storage = createLocalPrivateEvidenceStorage({
      rootDir: `../relative-private-${crypto.randomUUID()}`,
      nodeEnv: "development",
    });
    expect(storage.enabled).toBe(false);
    await expect(storage.write({ bytes: await image("png"), mimeType: "image/png" }))
      .rejects.toMatchObject({ code: "DISABLED" });
  });

  it("refuses a local upload root inside the application work tree", async () => {
    const root = join(process.cwd(), `.private-uploads-${crypto.randomUUID()}`);
    roots.push(root);
    const storage = createLocalPrivateEvidenceStorage({ rootDir: root, nodeEnv: "development" });
    expect(storage.enabled).toBe(false);
    await expect(storage.write({ bytes: await image("png"), mimeType: "image/png" }))
      .rejects.toMatchObject({ code: "DISABLED" });
  });

  it("refuses a root under the shared Git common directory", async () => {
    const { commonDir } = await currentGitRoots();
    const storage = createLocalPrivateEvidenceStorage({
      rootDir: join(commonDir, `verification-${crypto.randomUUID()}`),
      nodeEnv: "development",
    });
    expect(storage.enabled).toBe(false);
    await expect(storage.write({ bytes: await image("jpeg"), mimeType: "image/jpeg" }))
      .rejects.toMatchObject({ code: "DISABLED" });
  });

  it("refuses a root under the main worktree that owns the Git common directory", async () => {
    const { mainWorktree } = await currentGitRoots();
    const storage = createLocalPrivateEvidenceStorage({
      rootDir: join(mainWorktree, `verification-${crypto.randomUUID()}`),
      nodeEnv: "development",
    });
    expect(storage.enabled).toBe(false);
    await expect(storage.write({ bytes: await image("png"), mimeType: "image/png" }))
      .rejects.toMatchObject({ code: "DISABLED" });
  });

  it("resolves a real external junction or symlink that points back into the worktree", async () => {
    const container = await temporaryRoot();
    const link = join(container, "public-backlink");
    await symlink(join(process.cwd(), "src"), link, process.platform === "win32" ? "junction" : "dir");
    try {
      const storage = createLocalPrivateEvidenceStorage({ rootDir: link, nodeEnv: "development" });
      expect(storage.enabled).toBe(false);
      await expect(storage.write({ bytes: await image("png"), mimeType: "image/png" }))
        .rejects.toMatchObject({ code: "DISABLED" });
    } finally {
      await rm(link, { recursive: true, force: true });
    }
  });

  it("revalidates the canonical root when an external directory is replaced by a junction", async () => {
    const container = await temporaryRoot();
    const root = join(container, "replaceable-root");
    await writeFile(join(container, "keep-parent"), "parent");
    const storage = createLocalPrivateEvidenceStorage({
      rootDir: root,
      nodeEnv: "test",
      randomKey: () => "d".repeat(64),
    });
    expect(storage.enabled).toBe(true);
    await rm(root, { recursive: true, force: true });
    await symlink(join(process.cwd(), "src"), root, process.platform === "win32" ? "junction" : "dir");
    try {
      await expect(storage.write({ bytes: await image("jpeg"), mimeType: "image/jpeg" }))
        .rejects.toMatchObject({ code: "DISABLED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never follows a leaf evidence symlink for read or remove", async () => {
    const root = await temporaryRoot();
    const outside = join(root, "..", `outside-leaf-${crypto.randomUUID()}`);
    const storage = createLocalPrivateEvidenceStorage({ rootDir: root, nodeEnv: "test" });
    const evidence = await storage.write({ bytes: await image("png"), mimeType: "image/png" });
    const leaf = join(root, evidence.key);
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "sentinel.txt"), "private outside content");
    await rm(leaf, { force: true });
    await symlink(outside, leaf, process.platform === "win32" ? "junction" : "dir");
    try {
      await expect(storage.read(evidence.key)).rejects.toMatchObject({ code: "INVALID_KEY" });
      await expect(storage.remove(evidence.key)).rejects.toMatchObject({ code: "INVALID_KEY" });
      await expect(readFile(join(outside, "sentinel.txt"), "utf8")).resolves.toBe("private outside content");
    } finally {
      await rm(leaf, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("creates the root as 0700 and evidence as 0600 on POSIX", async () => {
    const container = await temporaryRoot();
    const root = join(container, "mode-root");
    const storage = createLocalPrivateEvidenceStorage({ rootDir: root, nodeEnv: "test" });
    const evidence = await storage.write({ bytes: await image("jpeg"), mimeType: "image/jpeg" });
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, evidence.key))).mode & 0o777).toBe(0o600);
  });

  it("uses wx and never overwrites an existing random-key collision", async () => {
    const root = await temporaryRoot();
    const key = `${"e".repeat(64)}.jpg`;
    await writeFile(join(root, key), "sentinel");
    const storage = createLocalPrivateEvidenceStorage({
      rootDir: root, nodeEnv: "test", randomKey: () => "e".repeat(64),
    });
    await expect(storage.write({ bytes: await image("jpeg"), mimeType: "image/jpeg" }))
      .rejects.toMatchObject({ code: "INVALID_KEY" });
    await expect(readFile(join(root, key), "utf8")).resolves.toBe("sentinel");
  });

  it("removes a partial leaf after a write failure and keeps the failure observable", async () => {
    const root = await temporaryRoot();
    const key = `${"f".repeat(64)}.png`;
    const storage = createLocalPrivateEvidenceStorage({
      rootDir: root,
      nodeEnv: "test",
      randomKey: () => "f".repeat(64),
      fileOperations: {
        async write(path, bytes, options) {
          await writeFile(path, bytes.subarray(0, 1), options);
          throw new Error("synthetic partial write failure");
        },
      },
    });
    await expect(storage.write({ bytes: await image("png"), mimeType: "image/png" }))
      .rejects.toMatchObject({ code: "WRITE_FAILED", cause: expect.any(Error) });
    await expect(readFile(join(root, key))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("surfaces partial-write cleanup failure as a combined observable error", async () => {
    const root = await temporaryRoot();
    const storage = createLocalPrivateEvidenceStorage({
      rootDir: root,
      nodeEnv: "test",
      randomKey: () => "a".repeat(64),
      fileOperations: {
        async write(path, bytes, options) {
          await writeFile(path, bytes.subarray(0, 1), options);
          throw new Error("synthetic partial write failure");
        },
        async remove() { throw new Error("synthetic partial cleanup failure"); },
      },
    });
    await expect(storage.write({ bytes: await image("jpeg"), mimeType: "image/jpeg" }))
      .rejects.toMatchObject({ code: "CLEANUP_FAILED", cause: expect.any(AggregateError) });
  });

  it("removes the private file when repository persistence fails", async () => {
    const storage = createLocalPrivateEvidenceStorage({ rootDir: await temporaryRoot(), nodeEnv: "test" });
    let key = "";
    await expect(storePrivateEvidence(
      storage,
      { bytes: await image("png"), mimeType: "image/png" },
      async (evidence) => {
        key = evidence.key;
        throw new Error("synthetic database failure");
      },
      async () => ({ state: "not-committed" }),
    )).rejects.toThrow("synthetic database failure");
    await expect(storage.read(key)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("preserves commit-unknown evidence when reconciliation itself fails", async () => {
    const storage = createLocalPrivateEvidenceStorage({ rootDir: await temporaryRoot(), nodeEnv: "test" });
    let key = "";
    await expect(storePrivateEvidence(
      storage,
      { bytes: await image("jpeg"), mimeType: "image/jpeg" },
      async (stored) => {
        key = stored.key;
        throw new Error("connection lost after COMMIT");
      },
      async () => { throw new Error("reconciliation database unavailable"); },
    )).rejects.toMatchObject({ code: "COMMIT_UNKNOWN" });
    await expect(storage.read(key)).resolves.toBeInstanceOf(Buffer);
  });

  it("surfaces cleanup failure with both persistence and filesystem causes", async () => {
    const local = createLocalPrivateEvidenceStorage({ rootDir: await temporaryRoot(), nodeEnv: "test" });
    const storage = {
      ...local,
      remove: async () => { throw new Error("synthetic unlink failure"); },
    };
    let thrown: unknown;
    try {
      await storePrivateEvidence(
        storage,
        { bytes: await image("png"), mimeType: "image/png" },
        async () => { throw new Error("synthetic database failure"); },
        async () => ({ state: "not-committed" }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EvidencePersistenceError);
    expect(thrown).toMatchObject({ code: "CLEANUP_FAILED", cause: expect.any(AggregateError) });
    expect((thrown as Error & { cause: AggregateError }).cause.errors.map(String).join(" "))
      .toMatch(/synthetic database failure.*synthetic unlink failure/);
  });
});
