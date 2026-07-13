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

export function createDirectoryHandlers(repository: DirectoryRepository) {
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
      async detail(id: string) {
        try {
          const teacher = await repository.getTeacher(publicIdSchema.parse(id));
          return teacher
            ? NextResponse.json({ teacher })
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
      async detail(id: string) {
        try {
          const tutoringRequest = await repository.getRequest(publicIdSchema.parse(id));
          return tutoringRequest
            ? NextResponse.json({ request: tutoringRequest })
            : NextResponse.json({ error: "家教需求不存在", code: "NOT_FOUND" }, { status: 404 });
        } catch (error) {
          return queryError(error);
        }
      },
    },
  };
}
