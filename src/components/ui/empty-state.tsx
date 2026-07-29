import type { ReactNode } from "react";

type EmptyStateProps = {
  action?: ReactNode;
  description: string;
  eyebrow?: string;
  title: string;
};

export function EmptyState({
  action,
  description,
  eyebrow = "暂时还没有内容",
  title,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state__mark" aria-hidden="true">
        空
      </span>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
