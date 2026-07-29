import { NextResponse } from "next/server";
import { z } from "zod";

import {
  DirectoryQueryError,
  parseRequestDirectoryQuery,
  parseTeacherDirectoryQuery,
} from "./query";
import type { DirectoryRepository } from "./repository";

const publicIdSchema = z.string().uuid();

function queryError(error: unknown) {
  if (error instanceof DirectoryQueryError || error instanceof z.ZodError) {
    return NextResponse.json(
      { error: "筛选条件格式不正确", code: "INVALID_QUERY" },
      { status: 400 },
    );
  }
  throw error;
}

function pagination(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

type DetailRole = "parent" | "teacher";
type DetailAuthorizer = (request: Request, role: DetailRole) => Promise<boolean>;

export function createDirectoryHandlers(
  repository: DirectoryRepository,
  authorizeDetail: DetailAuthorizer = async () => false,
) {
  return {
    teachers: {
      async GET(request: Request) {
        try {
          const result = await repository.listTeachers(
            parseTeacherDirectoryQuery(new URL(request.url).searchParams),
          );
          return NextResponse.json({
            teachers: result.items,
            pagination: pagination(result.page, result.pageSize, result.total),
          });
        } catch (error) {
          return queryError(error);
        }
      },
      async detail(request: Request, id: string) {
        try {
          const publicId = publicIdSchema.parse(id);
          const authenticated = await authorizeDetail(request, "parent");
          const teacher = authenticated
            ? await repository.getTeacherDetail(publicId)
            : await repository.getTeacherPreview(publicId);
          return teacher
            ? NextResponse.json({ access: authenticated ? "detail" : "preview", teacher })
            : NextResponse.json({ error: "教师资料不存在", code: "NOT_FOUND" }, { status: 404 });
        } catch (error) {
          return queryError(error);
        }
      },
    },
    requests: {
      async GET(request: Request) {
        try {
          const result = await repository.listRequests(
            parseRequestDirectoryQuery(new URL(request.url).searchParams),
          );
          return NextResponse.json({
            requests: result.items,
            pagination: pagination(result.page, result.pageSize, result.total),
          });
        } catch (error) {
          return queryError(error);
        }
      },
      async detail(request: Request, id: string) {
        try {
          const publicId = publicIdSchema.parse(id);
          const authenticated = await authorizeDetail(request, "teacher");
          const tutoringRequest = authenticated
            ? await repository.getRequestDetail(publicId)
            : await repository.getRequestPreview(publicId);
          return tutoringRequest
            ? NextResponse.json({ access: authenticated ? "detail" : "preview", request: tutoringRequest })
            : NextResponse.json({ error: "家教需求不存在", code: "NOT_FOUND" }, { status: 404 });
        } catch (error) {
          return queryError(error);
        }
      },
    },
  };
}
