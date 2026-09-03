import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  description?: string;
  trend?: { value: number; label: string };
  className?: string;
  iconBg?: string;
}

export function StatsCard({
  title,
  value,
  icon,
  description,
  trend,
  className,
  iconBg = 'bg-primary-50 text-primary-600',
}: StatsCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface p-4 shadow-card transition-shadow duration-200 hover:shadow-card-hover sm:p-5',
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          <p className="text-xs font-medium leading-snug text-text-secondary sm:text-sm">{title}</p>
          <p className="truncate text-2xl font-bold tracking-tight tabular-nums text-text-primary sm:text-3xl">
            {value}
          </p>
          {description && (
            <p className="text-xs text-text-tertiary">{description}</p>
          )}
          {trend && (
            <div className="flex items-center gap-1 text-xs">
              <span
                className={cn(
                  'font-medium',
                  trend.value >= 0 ? 'text-emerald-600' : 'text-red-600'
                )}
              >
                {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}%
              </span>
              <span className="text-text-tertiary">{trend.label}</span>
            </div>
          )}
        </div>
        <div className={cn('shrink-0 rounded-xl p-2 sm:p-3', iconBg)} aria-hidden="true">
          {icon}
        </div>
      </div>
    </div>
  );
}
