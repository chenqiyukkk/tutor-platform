"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";

import { type AuthRole } from "./schemas";
import { FORGOT_PASSWORD_MESSAGE, INVALID_RESET_TOKEN_MESSAGE } from "./password-reset-messages";

type PasswordRecoveryFormProps =
  | { mode: "forgot"; role: AuthRole }
  | { mode: "reset"; role: AuthRole };

export function PasswordRecoveryForm(props: PasswordRecoveryFormProps) {
  const { mode, role } = props;
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(mode === "forgot" ? "" : null);

  useEffect(() => {
    if (mode !== "reset") return;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token")?.trim() ?? "";
    window.history.replaceState(null, "", window.location.pathname);
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setResetToken(token);
      if (!token) setError(INVALID_RESET_TOKEN_MESSAGE);
    });
    return () => {
      active = false;
    };
  }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "reset" && !resetToken) {
      setError(INVALID_RESET_TOKEN_MESSAGE);
      return;
    }
    setMessage(undefined);
    setError(undefined);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const body = mode === "forgot"
      ? { email: form.get("email") }
      : { token: resetToken, newPassword: form.get("newPassword") };

    try {
      const response = await fetch(`/api/auth/${role}/${mode === "forgot" ? "forgot-password" : "reset-password"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(mode === "forgot" ? FORGOT_PASSWORD_MESSAGE : INVALID_RESET_TOKEN_MESSAGE);
        return;
      }
      if (mode === "forgot") {
        setMessage(FORGOT_PASSWORD_MESSAGE);
      } else {
        window.location.assign(response.url || `/${role}/login`);
      }
    } catch {
      setError(mode === "forgot" ? FORGOT_PASSWORD_MESSAGE : INVALID_RESET_TOKEN_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      {mode === "forgot" ? (
        <FormField htmlFor={`${role}-recovery-email`} label="邮箱" required>
          <input autoComplete="email" maxLength={254} name="email" required type="email" />
        </FormField>
      ) : (
        <FormField
          hint="至少 12 个字符"
          htmlFor={`${role}-new-password`}
          label="新密码"
          required
        >
          <input
            autoComplete="new-password"
            maxLength={128}
            minLength={12}
            name="newPassword"
            required
            type="password"
          />
        </FormField>
      )}
      {message ? <p className="auth-form__success" role="status">{message}</p> : null}
      {error ? <p className="auth-form__error" role="alert">{error}</p> : null}
      <Button
        className="auth-form__submit"
        disabled={submitting || (mode === "reset" && !resetToken)}
        type="submit"
      >
        {submitting ? "正在提交…" : mode === "forgot" ? "发送重置链接" : "重置密码"}
      </Button>
    </form>
  );
}
