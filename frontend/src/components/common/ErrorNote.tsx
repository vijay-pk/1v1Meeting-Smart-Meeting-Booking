import { AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Inline error message.
 *
 * SettingsPage alone had five different error treatments. This is the one presentation:
 * distinct without shouting, sitting next to whatever failed rather than at the top of the
 * page, and announced to screen readers via role="alert".
 *
 * It only ever renders the message it is given — the backend's own wording. Nothing here
 * inspects, rewrites or reveals internals.
 */
export function ErrorNote({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-xl border border-red-200 bg-error-bg px-3 py-2.5 text-red-700',
        className
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-xs font-medium leading-relaxed sm:text-sm">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="press inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
}
