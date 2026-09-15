"use client";

/**
 * The form controls `/admin` needs.
 *
 * `components/ui/` has no input primitive and it is another agent's path, so these live with the
 * page that uses them, as `components/verify/fields.tsx` does for `/verify`. Two differences from
 * that set, both driven by what this page asks people to type:
 *
 *  - every value here is a **number the contract will store as an integer** or an address, so the
 *    input is monospaced with tabular figures (`.num` / `.addr`) and free text rather than
 *    `type="number"` — a spinner and a locale-dependent decimal separator are both wrong for money;
 *  - a field can carry a *suffix* (`USDC`, `hbTRS`) and a row of quick-fill buttons, because the
 *    values an operator wants are usually "the current one" or "the one the contract suggests".
 */

import * as React from "react";

import { cn } from "@/lib/utils";

const CONTROL_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export interface AdminFieldProps {
  id: string;
  label: React.ReactNode;
  /** Help text, always announced with the control. */
  hint?: React.ReactNode;
  /** A problem with what is currently typed. Announced, and turns the border red. */
  error?: string | null;
  /** Quick-fill buttons and anything else that belongs under the control. */
  children?: React.ReactNode;
  /** The control itself. */
  control: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": true | undefined;
  }) => React.ReactNode;
  className?: string;
}

export function AdminField({
  id,
  label,
  hint,
  error,
  children,
  control,
  className,
}: AdminFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-ink text-sm font-medium">
        {label}
      </label>
      {control({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {children}
      {error ? (
        <p id={errorId} className="text-danger text-sm">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-muted text-xs leading-relaxed">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface AdminInputProps extends React.ComponentProps<"input"> {
  /** Unit shown inside the box, e.g. `USDC`. */
  suffix?: string;
  /** `num` for figures that line up, `addr` for addresses and hashes, `none` for prose. */
  mono?: "num" | "addr" | "none";
  invalid?: boolean;
}

export const AdminInput = React.forwardRef<HTMLInputElement, AdminInputProps>(function AdminInput(
  { suffix, mono = "num", invalid, className, ...props },
  ref,
) {
  return (
    <div
      className={cn(
        "border-border-strong bg-surface focus-within:outline-ring flex items-center gap-2 rounded-md border px-3",
        "focus-within:outline-2 focus-within:outline-offset-2",
        invalid && "border-danger",
        props.disabled && "opacity-60",
      )}
    >
      <input
        ref={ref}
        type="text"
        autoComplete="off"
        spellCheck={false}
        className={cn(
          mono === "none" ? null : mono,
          "text-ink placeholder:text-muted h-10 w-full bg-transparent text-sm outline-none disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      />
      {suffix ? <span className="text-muted shrink-0 text-xs font-medium">{suffix}</span> : null}
    </div>
  );
});

export const AdminSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  function AdminSelect({ className, ...props }, ref) {
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

/** A row of "fill this in for me" buttons under a field. */
export function QuickFills({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/** Label and value, monospaced, for the little fact rows each card carries. */
export function FactRow({
  label,
  value,
  mono = "num",
  tone,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  mono?: "num" | "addr" | null;
  tone?: "warning" | "danger" | "success";
}) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd
        className={cn(
          "text-ink",
          mono === "num" && "num",
          mono === "addr" && "addr",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </dd>
    </>
  );
}

export function FactList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]", className)}>
      {children}
    </dl>
  );
}

export interface AdminCheckboxProps {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}

/**
 * A native checkbox. Unstyled on purpose beyond size and accent: styling one pushes Chromium off
 * its own control rendering, and the platform control already follows `color-scheme` in both themes.
 */
export function AdminCheckbox({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  tone = "default",
}: AdminCheckboxProps) {
  const describedBy = description ? `${id}-description` : undefined;
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md border p-3",
        tone === "danger" && checked
          ? "border-danger-surface bg-danger-surface"
          : "border-border bg-surface",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onCheckedChange(event.target.checked)}
          className={cn(
            "accent-accent mt-0.5 size-4 shrink-0",
            "disabled:cursor-not-allowed disabled:opacity-50",
            CONTROL_RING,
          )}
        />
        <label htmlFor={id} className="text-ink cursor-pointer text-sm leading-relaxed font-medium">
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
