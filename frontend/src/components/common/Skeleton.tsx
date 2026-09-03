import { cn } from '@/lib/utils';

/**
 * Loading placeholders.
 *
 * Skeletons replace the five different spinner treatments the app had accumulated. They
 * reserve the space the real content will occupy, so nothing jumps when the data lands.
 *
 * These are shapes, never fabricated content — no sample names, prices or dates appear in a
 * loading state.
 */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('skeleton rounded-lg', className)}
      aria-hidden="true"
    />
  );
}

/** Skeleton for a list of rows, e.g. bookings or sessions. */
export function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4"
        >
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="hidden h-6 w-20 shrink-0 rounded-full sm:block" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Skeleton for a row of stat tiles. */
export function SkeletonStats({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div
      className={cn('grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4', className)}
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-16" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Inline spinner for buttons and small regions. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent',
        className
      )}
      aria-hidden="true"
    />
  );
}
