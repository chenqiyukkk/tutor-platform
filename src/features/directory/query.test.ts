import { describe, expect, it } from "vitest";

import {
  DirectoryQueryError,
  directoryFilterKey,
  parseRequestDirectoryQuery,
  parseTeacherDirectoryQuery,
} from "./query";

describe("directory query parsing", () => {
  it("parses applicable teacher filters and clamps nothing silently", () => {
    const query = parseTeacherDirectoryQuery(new URLSearchParams(
      "district=11111111-1111-4111-8111-111111111111&subject=22222222-2222-4222-8222-222222222222&identityType=FULL_TIME_TEACHER&mode=ONLINE&budgetMin=10000&budgetMax=20000&page=2&pageSize=6",
    ));

    expect(query).toEqual({
      district: "11111111-1111-4111-8111-111111111111",
      subject: "22222222-2222-4222-8222-222222222222",
      identityType: "FULL_TIME_TEACHER",
      mode: "ONLINE",
      budgetMin: 10000,
      budgetMax: 20000,
      page: 2,
      pageSize: 6,
    });
  });

  it.each([
    "unknown=value",
    "district=",
    "page=1&page=2",
    "identityType=NOT_REAL",
    "pageSize=25",
    "page=101",
    "budgetMin=200&budgetMax=100",
    "mode=BOTH",
  ])("rejects invalid teacher query %s", (search) => {
    expect(() => parseTeacherDirectoryQuery(new URLSearchParams(search)))
      .toThrow(DirectoryQueryError);
  });

  it("rejects teacher-only filters on request directories", () => {
    expect(() => parseRequestDirectoryQuery(new URLSearchParams(
      "identityType=FULL_TIME_TEACHER",
    ))).toThrow(DirectoryQueryError);
  });

  it("parses request filters with safe defaults", () => {
    expect(parseRequestDirectoryQuery(new URLSearchParams("mode=OFFLINE"))).toEqual({
      mode: "OFFLINE",
      page: 1,
      pageSize: 12,
    });
  });

  it("builds a stable filter key independent of URL order and pagination", () => {
    const first = parseTeacherDirectoryQuery(new URLSearchParams(
      "subject=22222222-2222-4222-8222-222222222222&district=11111111-1111-4111-8111-111111111111&page=2",
    ));
    const second = parseTeacherDirectoryQuery(new URLSearchParams(
      "page=9&district=11111111-1111-4111-8111-111111111111&subject=22222222-2222-4222-8222-222222222222",
    ));

    expect(directoryFilterKey(first)).toBe(directoryFilterKey(second));
    expect(directoryFilterKey(first)).toBe(
      "district=11111111-1111-4111-8111-111111111111&subject=22222222-2222-4222-8222-222222222222",
    );
  });
});
