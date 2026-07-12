import type { ReactNode } from "react";

type FormFieldProps = {
  children: ReactNode;
  error?: string;
  hint?: string;
  htmlFor: string;
  label: string;
  required?: boolean;
};

export function FormField({
  children,
  error,
  hint,
  htmlFor,
  label,
  required = false,
}: FormFieldProps) {
  return (
    <div className={`form-field ${error ? "form-field--error" : ""}`.trim()}>
      <label htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
        {required ? <span className="sr-only">（必填）</span> : null}
      </label>
      {hint ? <p className="form-field__hint">{hint}</p> : null}
      {children}
      {error ? (
        <p className="form-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
