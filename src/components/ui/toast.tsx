import type { ReactNode } from "react";

type ToastTone = "success" | "info" | "warning";

type ToastProps = {
  action?: ReactNode;
  description?: string;
  title: string;
  tone?: ToastTone;
};

export function Toast({
  action,
  description,
  title,
  tone = "info",
}: ToastProps) {
  return (
    <div
      className={`toast toast--${tone}`}
      role={tone === "warning" ? "alert" : "status"}
    >
      <span className="toast__mark" aria-hidden="true" />
      <div className="toast__body">
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="toast__action">{action}</div> : null}
    </div>
  );
}
