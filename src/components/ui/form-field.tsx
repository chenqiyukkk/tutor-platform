import { cloneElement } from "react";
import type { AriaAttributes, ReactElement } from "react";

type FormControlProps = Pick<
  AriaAttributes,
  "aria-describedby" | "aria-errormessage" | "aria-invalid"
> & {
  id?: string;
  required?: boolean;
};

type FormControlElement = ReactElement<
  FormControlProps,
  "input" | "select" | "textarea"
>;

type FormFieldProps = {
  children: FormControlElement;
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
  const hintId = `${htmlFor}-hint`;
  const errorId = `${htmlFor}-error`;
  const describedBy = [
    children.props["aria-describedby"],
    hint ? hintId : undefined,
    error ? errorId : undefined,
  ]
    .filter(Boolean)
    .join(" ") || undefined;
  const control = cloneElement(children, {
    "aria-describedby": describedBy,
    "aria-errormessage": error
      ? errorId
      : children.props["aria-errormessage"],
    "aria-invalid": error ? true : children.props["aria-invalid"],
    id: htmlFor,
    required: required || children.props.required || undefined,
  });

  return (
    <div className={`form-field ${error ? "form-field--error" : ""}`.trim()}>
      <label htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
        {required ? <span className="sr-only">（必填）</span> : null}
      </label>
      {hint ? (
        <p className="form-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {control}
      {error ? (
        <p className="form-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
