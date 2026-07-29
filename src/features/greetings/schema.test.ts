import { describe, expect, it } from "vitest";

import {
  decodeGreetingCursor,
  encodeGreetingCursor,
  greetingInboxQuerySchema,
  greetingNoteSchema,
} from "./schema";
import { currentGreetingCardSnapshotSchema } from "./card-schema";

describe("greeting note schema", () => {
  it("accepts an empty trimmed note and exactly 100 Unicode code points", () => {
    expect(greetingNoteSchema.parse("   ")).toBe("");
    const note = "好".repeat(99) + "🙂";
    expect(Array.from(note)).toHaveLength(100);
    expect(greetingNoteSchema.parse(note)).toBe(note);
  });

  it("rejects more than 100 Unicode code points", () => {
    expect(() => greetingNoteSchema.parse("🙂".repeat(101))).toThrow();
  });

  it.each([
    "手机号 138 0013 8000",
    "电话 138-0013-8000",
    "电话 1 3 8 0 0 1 3 8 0 0 0",
    "电话 138.0013.8000",
    "电话 (+86) 138/0013/8000",
    "电话 （＋８６）１３８．００１３．８０００",
    "电话 138_0013_8000",
    "138，0013，8000",
    "138•0013•8000",
    "138·0013·8000",
    "电话 １３８＿００１３＿８０００",
    "电话 1\u200B38\u20600013\uFEFF8000",
    "wx:abc",
    "加wx abc123",
    "我的wx:abc",
    "留vx ID abc123",
    "联系vx abc123",
    "加w\u200Bx：abc",
    "wx abc123",
    "vx ID abc123",
    "ｗｘ：ａｂｃ",
    "w\u200Bx:abc",
    "加微 xin abc123",
    "加v信 abc123",
    "留 v x 详聊",
    "加扣扣 123456",
    "wechat 找我",
    "we chat 找我",
    "weixin 找我",
    "QQ：12345678",
    "扫二维码联系",
    "邮箱 tutor@example.com",
    "链接 https://example.com",
    "主页 example.com",
    "加好友后付信息费",
    "联系方式私聊发你",
    "WhatsApp: tutor_88",
    "whats app 找我",
    "W​hats​App tutor_88",
    "Telegram @tutor88",
    "tele gram 联系我",
    "TG: tutor_88",
    "座机 020 12345678",
    "电话 ０２０－１２３４５６７８",
  ])("rejects contact or off-platform language: %s", (note) => {
    expect(() => greetingNoteSchema.parse(note)).toThrow();
  });

  it.each([
    "我擅长初中数学，可以先交流孩子目前的薄弱点。",
    "周日下午有空，愿意按照平台流程进一步沟通。",
    "我住在朝阳区，线下或线上都可以。",
    "希望老师有三年以上教学经验。",
    "可以接受按课时付费，预算以内即可。",
    "可以讲解 wxWidgets 的基础用法。",
    "熟悉 AVX 指令优化，但会按学生水平讲解。",
  ])("does not reject legitimate tutoring notes: %s", (note) => {
    expect(greetingNoteSchema.parse(note)).toBe(note);
  });
});

describe("greeting card contact policy", () => {
  const card = {
    teacher: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      publicNickname: "林老师",
      identityType: "FULL_TIME_TEACHER" as const,
      headline: "把数学讲清楚",
      yearsExperience: 5,
      rateMinCents: 10_000,
      rateMaxCents: 15_000,
      online: true,
      verified: true,
      subjects: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "数学" }],
      serviceAreas: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "天河区", isPrimary: true }],
    },
    request: {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      title: "初二数学巩固",
      studentAlias: "小树",
      gradeLevel: "GRADE_8",
      budgetMinCents: 8_000,
      budgetMaxCents: 12_000,
      teachingMode: "BOTH" as const,
      scheduleText: "周末下午",
      region: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "天河区" },
      subjects: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "数学" }],
    },
  };

  it.each([
    ["teacher", { headline: "WhatsApp: tutor_88" }],
    ["request", { scheduleText: "Telegram @tutor88" }],
    ["request", { studentAlias: "TG: pupil88" }],
  ] as const)("rejects contact details in %s user text", (side, override) => {
    expect(() => currentGreetingCardSnapshotSchema.parse({
      ...card,
      [side]: { ...card[side], ...override },
    })).toThrow();
  });
});

describe("greeting inbox cursor schema", () => {
  it("round-trips a canonical timestamp and UUID cursor", () => {
    const value = {
      createdAt: new Date("2026-07-13T06:00:00.123Z"),
      id: "00000000-0000-4000-8000-000000000001",
    };
    const cursor = encodeGreetingCursor(value);

    expect(decodeGreetingCursor(cursor)).toEqual(value);
    expect(greetingInboxQuerySchema.parse({ box: "sent", pageSize: "20", cursor }))
      .toEqual({ box: "sent", pageSize: 20, cursor });
  });

  it.each([
    "",
    "not+base64",
    Buffer.from("{}", "utf8").toString("base64url"),
    Buffer.from(JSON.stringify({ createdAt: "not-a-date", id: "00000000-0000-4000-8000-000000000001" }), "utf8").toString("base64url"),
    Buffer.from(JSON.stringify({ createdAt: "2026-07-13T06:00:00.123Z", id: "not-a-uuid" }), "utf8").toString("base64url"),
    "a".repeat(257),
  ])("rejects a malformed cursor: %s", (cursor) => {
    expect(() => greetingInboxQuerySchema.parse({ cursor })).toThrow();
  });

  it("rejects legacy page offsets and unknown query fields", () => {
    expect(() => greetingInboxQuerySchema.parse({ page: 1 })).toThrow();
    expect(() => greetingInboxQuerySchema.parse({ ownerAccountId: crypto.randomUUID() })).toThrow();
  });
});
