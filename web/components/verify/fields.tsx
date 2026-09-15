"use client";

/**
 * The three form controls `/verify` needs, built on native elements.
 *
 * `components/ui/` has no input, select, checkbox or radio yet, and it is another agent's path, so
 * these live with the page that needs them. They are native `<select>`, `<input type="checkbox">`
 * and `<input type="radio">` on purpose rather than Radix or a listbox of divs: a select with ~250
 * options is one place where the platform control — type-ahead, mobile wheel, an `option` that is
 * genuinely `disabled` rather than only `aria-disabled` — beats anything hand-rolled.
 *
 * Every control here takes a real `id`, is labelled by a real `<label htmlFor>`, and exposes its
 * help text through `aria-describedby`. When these move into `components/ui/` they should keep that
 * shape.
 */

import * as React from "react";

import { cn } from "@/lib/utils";

const CONTROL_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function FieldLabel({
  htmlFor,
  children,
  className,
}: {
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("text-ink text-sm font-medium", className)}>
      {children}
    </label>
  );
}

export function FieldHint({
  id,
  children,
  className,
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p id={id} className={cn("text-muted text-xs leading-relaxed", className)}>
      {children}
    </p>
  );
}

export const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "border-border-strong bg-surface text-ink h-10 w-full rounded-md border px-3 text-sm",
          "disabled:cursor-not-allowed disabled:opacity-50",
          CONTROL_RING,
          className,
        )}
        {...props}
      />
    );
  },
);

export interface CheckboxFieldProps {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** A checkbox whose whole label is the hit target, and whose help text is announced with it. */
export function CheckboxField({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: CheckboxFieldProps) {
  const describedBy = description ? `${id}-description` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onCheckedChange(event.target.checked)}
          // No border or radius utilities: styling a native checkbox pushes Chromium off its own
          // control rendering, and the platform one already follows `color-scheme` in both themes.
          className={cn(
            "accent-accent mt-0.5 size-4 shrink-0",
            "disabled:cursor-not-allowed disabled:opacity-50",
            CONTROL_RING,
          )}
        />
        <label htmlFor={id} className="text-ink cursor-pointer text-sm leading-relaxed">
          {label}
        </label>
      </div>
      {description ? (
        <p id={describedBy} className="text-muted pl-7 text-xs leading-relaxed">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  description: React.ReactNode;
}

export interface RadioCardsProps<T extends string> {
  name: string;
  legend: React.ReactNode;
  hint?: React.ReactNode;
  value: T;
  options: readonly RadioOption<T>[];
  onValueChange: (value: T) => void;
  disabled?: boolean;
}

/**
 * A radiogroup rendered as cards. A `<fieldset>` with a real `<legend>`, so the question is
 * announced once and each answer keeps its own description.
 */
export function RadioCards<T extends string>({
  name,
  legend,
  hint,
  value,
  options,
  onValueChange,
  disabled,
}: RadioCardsProps<T>) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-ink text-sm font-medium">{legend}</legend>
      {hint ? <FieldHint className="mb-1">{hint}</FieldHint> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          const selected = value === option.value;
          return (
            <div
              key={option.value}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3",
                selected ? "border-accent bg-accent-surface" : "border-border bg-surface",
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                disabled={disabled}
                onChange={() => onValueChange(option.value)}
                aria-describedby={`${id}-description`}
                className={cn(
                  "accent-accent mt-0.5 size-4 shrink-0",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  CONTROL_RING,
                )}
              />
              <div className="min-w-0">
                <label htmlFor={id} className="text-ink cursor-pointer text-sm font-medium">
                  {option.label}
                </label>
                <p id={`${id}-description`} className="text-muted mt-0.5 text-xs leading-relaxed">
                  {option.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
