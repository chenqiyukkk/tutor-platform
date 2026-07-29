import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TeacherProfile } from "@/features/teachers/service";

import { ProfileForm } from "./profile-form";

const subject = { id: "11111111-1111-4111-8111-111111111111", name: "数学" };
const profile: TeacherProfile = {
  id: "99999999-9999-4999-8999-999999999999",
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  publicNickname: "林老师",
  headline: "帮学生建立数学思维",
  identityType: "FULL_TIME_TEACHER",
  bio: "十年一线教学经验，重视学习方法与思维习惯。",
  yearsExperience: 10,
  online: true,
  rateMinCents: 10000,
  rateMaxCents: 16000,
  status: "DRAFT",
  publishedAt: null,
  subjects: [subject],
  primaryRegion: { id: "22222222-2222-4222-8222-222222222222", name: "天河区" },
  extraRegions: [],
};

afterEach(() => vi.unstubAllGlobals());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("ProfileForm", () => {
  it("submits editable public fields and selected subjects as a draft", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      profile: { ...profile, publicNickname: "新昵称" },
      completion: { percentage: 100, missingItems: [] },
    }), { status: 200, headers: { "content-type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProfileForm initialProfile={profile} subjects={[subject]} />);

    await userEvent.clear(screen.getByLabelText("公开昵称"));
    await userEvent.type(screen.getByLabelText("公开昵称"), "新昵称");
    await userEvent.clear(screen.getByLabelText("公开标题"));
    await userEvent.type(screen.getByLabelText("公开标题"), "专注几何启发");
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/teacher/profile",
      expect.objectContaining({ method: "PUT" }),
    ));
    const saveCall = fetchMock.mock.calls.find(([url, options]) =>
      url === "/api/teacher/profile" && options?.method === "PUT");
    const body = JSON.parse(saveCall?.[1].body as string);
    expect(body).toMatchObject({
      publicNickname: "新昵称",
      headline: "专注几何启发",
      subjectIds: [subject.id],
      primaryRegionId: profile.primaryRegion?.id,
    });
    expect(body).not.toHaveProperty("accountId");
    expect(await screen.findByRole("status")).toHaveTextContent("草稿已保存");
  });

  it("shows field-level errors returned by the API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "教师资料校验失败",
      fieldErrors: { publicNickname: ["公开昵称不能超过 40 个字符"] },
    }), { status: 400, headers: { "content-type": "application/json" } })));
    render(<ProfileForm initialProfile={profile} subjects={[subject]} />);

    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    const error = await screen.findByText("公开昵称不能超过 40 个字符");
    expect(error).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText("公开昵称")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("公开昵称")).toHaveAttribute("aria-errormessage", error.id);
  });

  it("opens a privacy-safe profile preview", async () => {
    render(<ProfileForm initialProfile={profile} subjects={[subject]} />);
    await userEvent.click(screen.getByRole("button", { name: "预览公开资料" }));
    expect(screen.getByRole("heading", { name: "林老师" })).toBeInTheDocument();
    expect(screen.queryByText(profile.accountId)).not.toBeInTheDocument();
  });

  it("keeps real names for newly selected primary and extra districts in chips and preview", async () => {
    const province = { id: "44444444-4444-4444-8444-444444444444", code: "110000", name: "北京市", level: 1, parentId: null };
    const city = { id: "55555555-5555-4555-8555-555555555555", code: "110100", name: "北京市", level: 2, parentId: province.id };
    const districts = [
      { id: "66666666-6666-4666-8666-666666666666", code: "110108", name: "海淀区", level: 3, parentId: city.id },
      { id: "77777777-7777-4777-8777-777777777777", code: "110105", name: "朝阳区", level: 3, parentId: city.id },
    ];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) => {
      const url = new URL(input, "http://localhost");
      const level = url.searchParams.get("level");
      const rows = level === "1" ? [province] : level === "2" ? [city] : districts;
      return Promise.resolve(new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    }));
    render(<ProfileForm initialProfile={profile} subjects={[subject]} />);

    const provinceSelects = await screen.findAllByLabelText("省份");
    await waitFor(() => expect(provinceSelects[0]).toBeEnabled());
    await userEvent.selectOptions(provinceSelects[0], province.id);
    await userEvent.selectOptions(screen.getAllByLabelText("城市")[0], city.id);
    await userEvent.selectOptions(screen.getAllByLabelText("区县")[0], districts[0].id);

    await userEvent.selectOptions(provinceSelects[1], province.id);
    await userEvent.selectOptions(screen.getAllByLabelText("城市")[1], city.id);
    await userEvent.selectOptions(screen.getAllByLabelText("区县")[1], districts[1].id);
    expect(screen.queryByText("新选择区县")).not.toBeInTheDocument();
    expect(screen.getAllByText("海淀区").length).toBeGreaterThan(1);
    expect(screen.getAllByText("朝阳区").length).toBeGreaterThan(1);

    await userEvent.click(screen.getByRole("button", { name: "预览公开资料" }));
    expect(screen.getAllByText("海淀区").length).toBeGreaterThan(1);
    expect(screen.getAllByText(/朝阳区/).length).toBeGreaterThan(1);
  });

  it("publishes and unpublishes with explicit actions and status feedback", async () => {
    const actions: string[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input.startsWith("/api/regions")) {
        return Promise.resolve(new Response("[]", { status: 200 }));
      }
      if (init?.method === "PUT") {
        return Promise.resolve(new Response(JSON.stringify({ profile }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
      const { action } = JSON.parse(String(init?.body));
      actions.push(action);
      return Promise.resolve(new Response(JSON.stringify({
        profile: { ...profile, status: action === "publish" ? "PUBLISHED" : "DRAFT" },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }));
    render(<ProfileForm initialProfile={profile} subjects={[subject]} />);

    await userEvent.click(screen.getByRole("button", { name: "发布资料" }));
    expect(await screen.findByText("资料已发布")).toBeInTheDocument();
    expect(actions).toEqual(["publish"]);
    await userEvent.click(screen.getByRole("button", { name: "下架资料" }));
    expect(await screen.findByText("资料已下架并转为草稿")).toBeInTheDocument();
    expect(actions).toEqual(["publish", "unpublish"]);
  });

  it("locks the whole form synchronously and ignores rapid duplicate publish clicks", async () => {
    const draftResponse = deferred<Response>();
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input.startsWith("/api/regions")) return Promise.resolve(new Response("[]"));
      if (init?.method === "PUT") return draftResponse.promise;
      return Promise.resolve(new Response(JSON.stringify({
        profile: { ...profile, status: "PUBLISHED" },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProfileForm initialProfile={profile} subjects={[subject]} />);

    const publish = screen.getByRole("button", { name: "发布资料" });
    fireEvent.click(publish);
    fireEvent.click(publish);

    expect(screen.getByLabelText("公开昵称")).toBeDisabled();
    expect(screen.getByLabelText("数学")).toBeDisabled();
    expect(screen.getAllByLabelText("省份")[0]).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);

    draftResponse.resolve(new Response(JSON.stringify({ profile }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    expect(await screen.findByText("资料已发布")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("does not publish or apply a stale save response when values change in flight", async () => {
    const draftResponse = deferred<Response>();
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input.startsWith("/api/regions")) return Promise.resolve(new Response("[]"));
      if (init?.method === "PUT") return draftResponse.promise;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProfileForm initialProfile={profile} subjects={[subject]} />);

    fireEvent.click(screen.getByRole("button", { name: "发布资料" }));
    const nickname = screen.getByLabelText("公开昵称");
    fireEvent.change(nickname, { target: { value: "请求中的新值" } });
    draftResponse.resolve(new Response(JSON.stringify({
      profile: { ...profile, publicNickname: "服务器陈旧值" },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    expect(await screen.findByText("资料已发生变化，请重新操作")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(screen.getByLabelText("公开昵称")).toHaveValue("请求中的新值");
  });

  it("shows an honest empty state when no active subjects are available", () => {
    render(<ProfileForm initialProfile={null} subjects={[]} />);
    expect(screen.getByText("暂无可选科目，请稍后再试")).toBeInTheDocument();
  });
});
