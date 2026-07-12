"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";

import { roleLabels, type AuthRole, type PublicAuthRole } from "./schemas";

type AuthFormProps =
  | { mode: "login"; role: AuthRole }
  | { mode: "register"; role: PublicAuthRole };

export function AuthForm({ mode, role }: AuthFormProps) {
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const body = mode === "register"
      ? {
          username: form.get("username"),
          email: form.get("email"),
          password: form.get("password"),
        }
      : {
          identifier: form.get("identifier"),
          password: form.get("password"),
        };

    try {
      const response = await fetch(`/api/auth/${role}/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const result = await response.json() as { error?: string };
        setError(result.error ?? "提交失败，请稍后重试");
        return;
      }

      window.location.assign(response.url);
    } catch {
      setError("网络连接失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  const actionLabel = mode === "login"
    ? `登录${roleLabels[role]}账户`
    : `注册${roleLabels[role]}账户`;

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      {mode === "register" ? (
        <>
          <FormField htmlFor={`${role}-username`} label="用户名" required>
            <input
              autoComplete="username"
              maxLength={32}
              minLength={3}
              name="username"
              required
            />
          </FormField>
          <FormField htmlFor={`${role}-email`} label="邮箱" required>
            <input autoComplete="email" maxLength={254} name="email" required type="email" />
          </FormField>
        </>
      ) : (
        <FormField htmlFor={`${role}-identifier`} label="用户名或邮箱" required>
          <input autoComplete="username" maxLength={254} name="identifier" required />
        </FormField>
      )}
      <FormField
        hint={mode === "register" ? "至少 12 个字符" : undefined}
        htmlFor={`${role}-password`}
        label="密码"
        required
      >
        <input
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          maxLength={128}
          minLength={mode === "register" ? 12 : 1}
          name="password"
          required
          type="password"
        />
      </FormField>
      {error ? <p className="auth-form__error" role="alert">{error}</p> : null}
      <Button className="auth-form__submit" disabled={submitting} type="submit">
        {submitting ? "正在提交…" : actionLabel}
      </Button>
    </form>
  );
}
