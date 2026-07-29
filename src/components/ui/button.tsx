import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "quiet";
type ButtonSize = "default" | "small";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  className = "",
  variant = "primary",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button--${variant} button--${size} ${className}`.trim()}
      type={type}
      {...props}
    />
  );
}
