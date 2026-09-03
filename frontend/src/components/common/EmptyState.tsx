import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Empty state.
 *
 * The app had eight of these in three visual languages (emoji, lucide icon, bare text). This
 * is the single presentation, and it takes an `action` because an empty screen should say
 * what to do next, not just that there is nothing here.
 *
 * It never renders placeholder rows or sample records — an empty list stays visibly empty.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-12',
        className
      )}
    >
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-tertiary text-text-tertiary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-text-primary">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-xs leading-relaxed text-text-tertiary sm:text-sm">
            {description}
          </p>
        )}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
