import { describe, expect, it } from "vitest";

import { formatDirectoryDate } from "./date";

describe("directory date formatting", () => {
  it("uses Asia/Shanghai at a UTC date boundary", () => {
    expect(formatDirectoryDate("2026-07-01T16:30:00.000Z")).toBe("2026年7月2日");
  });
});
