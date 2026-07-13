import { describe, expect, it } from "vitest";

import { violatesContactPolicy } from "./contact-policy";

describe("public contact policy", () => {
  it.each([
    "小红书号 red123",
    "RED ID: tutor88",
    "抖音号 123456",
    "Douyin: tutor88",
    "TikTok @tutor88",
    "LINE ID tutor88",
    "Signal: tutor88",
    "请访问 teacher.example.com",
    "个人主页 tutor.cn",
  ])("rejects external contact channel: %s", (value) => {
    expect(violatesContactPolicy(value)).toBe(true);
  });

  it.each([
    "熟悉 Node.js 服务端开发",
    "使用 Vue.js 讲解组件化",
    "可以辅导 React.js 与 Next.js",
    "讲解 red-black tree 和 signal processing",
  ])("does not reject legitimate technical text: %s", (value) => {
    expect(violatesContactPolicy(value)).toBe(false);
  });
});
