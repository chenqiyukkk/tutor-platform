import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  tactile?: boolean;
};

export function Card({
  children,
  className = "",
  tactile = false,
  ...props
}: CardProps) {
  return (
    <div
      className={`card ${tactile ? "card--tactile" : ""} ${className}`.trim()}
      {...props}
    >
      {children}
    </div>
  );
}
