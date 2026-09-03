import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ThemePreference } from '@/hooks/useAdminTheme';

const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

/**
 * Light / Dark / System segmented control.
 *
 * A radiogroup rather than three buttons, so a screen reader announces it as one control with
 * a current selection, and arrow keys move between options.
 */
export function ThemeToggle({
  value,
  onChange,
  className,
  showLabels = false,
}: {
  value: ThemePreference;
  onChange: (next: ThemePreference) => void;
  className?: string;
  showLabels?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xl bg-surface-tertiary p-1',
        className
      )}
    >
      {OPTIONS.map(({ value: option, label, Icon }) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => onChange(option)}
            className={cn(
              'press inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
              showLabels ? 'h-11 flex-1 px-3' : 'h-9 w-9',
              selected
                ? 'bg-surface text-text-primary shadow-sm'
                : 'text-text-tertiary hover:text-text-primary'
            )}
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            {showLabels && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
