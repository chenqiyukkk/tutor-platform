import type { HTMLAttributes, ReactNode } from "react";

type BadgeTone = "forest" | "red" | "paper" | "muted";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: BadgeTone;
};

export function Badge({
  children,
  className = "",
  tone = "forest",
  ...props
}: BadgeProps) {
  return (
    <span className={`badge badge--${tone} ${className}`.trim()} {...props}>
      {children}
    </span>
  );
}
