import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One dataset, two presentations.
 *
 * Bookings, Customers and Payments all rendered a 5-8 column `<table>` inside
 * `overflow-x-auto`. On a phone that means sideways scrolling through a table whose first
 * column tells you nothing useful.
 *
 * Below `md` each row becomes a card built from the same column definitions; from `md` up it
 * is the same table as before. No column is dropped — a column marked `secondary` simply
 * moves into the card's detail rows instead of its header line.
 */

export interface DataColumn<T> {
  /** Column header, also used as the label in the mobile card. */
  header: string;
  /** Cell renderer. Receives the row. */
  cell: (row: T) => ReactNode;
  /** Header/cell alignment for the table view. */
  align?: 'left' | 'right';
  /** Shown as the card's title line on mobile. Exactly one column should set this. */
  primary?: boolean;
  /** Rendered on the card's title line, right-aligned (status, amount). */
  trailing?: boolean;
  /** Hidden in the table view below `lg`, but always present in the mobile card. */
  collapse?: boolean;
  className?: string;
}

export function DataList<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  empty,
  className,
}: {
  rows: T[];
  columns: Array<DataColumn<T>>;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  className?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className={cn('rounded-xl border border-border bg-surface', className)}>{empty}</div>
    );
  }

  const primary = columns.find((column) => column.primary) ?? columns[0];
  const trailing = columns.filter((column) => column.trailing);
  const details = columns.filter(
    (column) => column !== primary && !column.trailing
  );

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-surface shadow-card',
        className
      )}
    >
      {/* Mobile: one card per row. */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map((row) => {
          const interactive = Boolean(onRowClick);
          return (
            <li key={rowKey(row)}>
              <div
                {...(interactive
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      onClick: () => onRowClick?.(row),
                      onKeyDown: (event: React.KeyboardEvent) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onRowClick?.(row);
                        }
                      },
                    }
                  : {})}
                className={cn(
                  'flex flex-col gap-2 p-4',
                  interactive &&
                    'press cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 active:bg-surface-secondary'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 text-sm font-semibold text-text-primary">
                    {primary.cell(row)}
                  </div>
                  {trailing.length > 0 && (
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {trailing.map((column) => (
                        <div key={column.header} className="text-sm">
                          {column.cell(row)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {details.length > 0 && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    {details.map((column) => (
                      <div key={column.header} className="contents">
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                          {column.header}
                        </dt>
                        <dd className="min-w-0 break-words text-xs text-text-secondary">
                          {column.cell(row)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Tablet and up: the original table. */}
      <div className="hidden md:block">
        <table className="w-full">
          <thead className="border-b border-border bg-surface-secondary">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.header}
                  scope="col"
                  className={cn(
                    'px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-tertiary',
                    column.align === 'right' ? 'text-right' : 'text-left',
                    column.collapse && 'hidden lg:table-cell'
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'transition-colors hover:bg-surface-secondary/60',
                  onRowClick && 'cursor-pointer'
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className={cn(
                      'px-4 py-3 text-sm text-text-secondary',
                      column.align === 'right' ? 'text-right' : 'text-left',
                      column.collapse && 'hidden lg:table-cell',
                      column.className
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
