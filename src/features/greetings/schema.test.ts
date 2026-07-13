import { describe, expect, it } from "vitest";

import { greetingNoteSchema } from "./schema";

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
    "加微 xin abc123",
    "wechat 找我",
    "QQ：12345678",
    "扫二维码联系",
    "邮箱 tutor@example.com",
    "链接 https://example.com",
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
  ])("does not reject legitimate tutoring notes: %s", (note) => {
    expect(greetingNoteSchema.parse(note)).toBe(note);
  });
});
