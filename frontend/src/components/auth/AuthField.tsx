import * as React from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * One field pattern for every auth form.
 *
 * The five auth screens previously disagreed on label weight (medium/semibold/bold), input
 * text size (xs/sm/base) and icon offset (top-3 vs top-3.5 against the same 44px input).
 * This settles all three.
 *
 * Two details that matter on a phone:
 *  - the input is 16px until `sm`, because iOS Safari zooms the page when a focused input's
 *    font-size is under 16px, and the old `text-xs` fields triggered it on every tap;
 *  - the helper/error slot has a reserved height, so a validation message appearing does not
 *    push the rest of the form down under the user's thumb.
 */
export const AuthField = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & {
    id: string;
    label: string;
    icon?: ComponentType<{ className?: string }>;
    /** Persistent hint, e.g. "Minimum 6 characters". */
    hint?: ReactNode;
    /** Field-level error. Replaces the hint and marks the input invalid. */
    error?: string | null;
    /** Success message, e.g. an available username. */
    success?: string | null;
    /** Rendered inside the field on the right, e.g. a password visibility toggle. */
    trailing?: ReactNode;
    /** Reserve space for the helper line even when empty, to stop layout shift. */
    reserveHelper?: boolean;
    labelAction?: ReactNode;
  }
>(function AuthField(
  {
    id,
    label,
    icon: Icon,
    hint,
    error,
    success,
    trailing,
    reserveHelper = false,
    labelAction,
    className,
    ...inputProps
  },
  ref
) {
  const helperId = `${id}-helper`;
  const helper = error || success || hint;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs font-semibold text-text-secondary">
          {label}
        </Label>
        {labelAction}
      </div>

      <div className="relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
        )}
        <Input
          id={id}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={helper ? helperId : undefined}
          className={cn(
            'h-11 rounded-xl text-base sm:text-sm',
            Icon && 'pl-10',
            trailing && 'pr-12',
            error && 'border-red-400 focus-visible:ring-red-400',
            success && !error && 'border-emerald-400',
            className
          )}
          {...inputProps}
        />
        {trailing && (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</div>
        )}
      </div>

      {(helper || reserveHelper) && (
        <p
          id={helperId}
          className={cn(
            'min-h-[16px] text-[11px] leading-tight',
            error ? 'font-medium text-red-600' : success ? 'font-medium text-emerald-600' : 'text-text-tertiary'
          )}
        >
          {helper}
        </p>
      )}
    </div>
  );
});

/** Password visibility toggle, sized as a real 40px target rather than a bare icon. */
export function PasswordToggle({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
  }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? 'Hide password' : 'Show password'}
      title={visible ? 'Hide password' : 'Show password'}
      className="press inline-flex h-10 w-10 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      {visible ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  );
}

function EyeIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.2 3.2M6.6 6.6A17.8 17.8 0 0 0 2 11s3.5 7 10 7a9 9 0 0 0 5.4-1.6" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
