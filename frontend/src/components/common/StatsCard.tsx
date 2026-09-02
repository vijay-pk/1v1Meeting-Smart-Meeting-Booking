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
        'rounded-xl border border-border bg-white p-6 shadow-card hover:shadow-card-hover transition-shadow duration-200',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-text-secondary">{title}</p>
          <p className="text-3xl font-bold text-text-primary tracking-tight">{value}</p>
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
        <div className={cn('p-3 rounded-xl', iconBg)}>
          {icon}
        </div>
      </div>
    </div>
  );
}
