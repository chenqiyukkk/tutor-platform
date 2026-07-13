import { describe, expect, it } from "vitest";

import {
  decodeGreetingCursor,
  encodeGreetingCursor,
  greetingInboxQuerySchema,
  greetingNoteSchema,
} from "./schema";

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
