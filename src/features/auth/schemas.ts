import { z } from "zod";

export const authRoles = ["teacher", "parent", "admin"] as const;
export const publicAuthRoles = ["teacher", "parent"] as const;

export type AuthRole = (typeof authRoles)[number];
export type PublicAuthRole = (typeof publicAuthRoles)[number];

export const roleLabels: Record<AuthRole, string> = {
  teacher: "老师",
  parent: "家长",
  admin: "管理员",
};

export const roleDashboardPath: Record<AuthRole, string> = {
  teacher: "/teacher/dashboard",
  parent: "/parent/dashboard",
  admin: "/admin/dashboard",
};

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "用户名至少需要 3 个字符")
  .max(32, "用户名不能超过 32 个字符")
  .regex(/^[\p{L}\p{N}._-]+$/u, "用户名只能包含文字、数字、点、下划线或连字符");

export const emailSchema = z.string().trim().email("请输入有效的邮箱地址").max(254);

export const passwordSchema = z
  .string()
  .min(12, "密码至少需要 12 个字符")
  .max(128, "密码不能超过 128 个字符");

export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, "请输入用户名或邮箱").max(254),
  password: z.string().min(1, "请输入密码").max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export function normalizeUsername(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

export function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

export function parseAuthRole(value: string): AuthRole {
  return z.enum(authRoles).parse(value);
}

export function parsePublicAuthRole(value: string): PublicAuthRole {
  return z.enum(publicAuthRoles).parse(value);
}
