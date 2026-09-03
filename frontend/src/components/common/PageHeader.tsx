import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The page title block used at the top of every admin page.
 *
 * Five pages previously wrote this as `flex items-center justify-between` with no mobile
 * stacking, so on a phone the heading and its action button fought over ~272px. Stacking
 * below `sm` is the whole point of putting it in one place.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4',
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-text-primary sm:text-2xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
