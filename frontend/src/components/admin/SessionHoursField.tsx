import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DAYS_SHORT } from '@/lib/constants';
import { cn } from '@/lib/utils';

export interface SessionTimeWindow {
  day_of_week: number; // 0 = Sunday ... 6 = Saturday
  start_time: string; // HH:MM
  end_time: string; // HH:MM
}

export interface SessionHoursDraft {
  mode: 'general' | 'specific';
  perDay: boolean;
  start: string;
  end: string;
  days: { enabled: boolean; start: string; end: string }[]; // index = day_of_week
}

// Monday first, as the Availability page reads.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Builds the form state from what the server stored. No windows = general availability. */
export function draftFromWindows(windows: SessionTimeWindow[] | null | undefined): SessionHoursDraft {
  const days = ALL_DAYS.map(() => ({ enabled: false, start: '10:00', end: '14:00' }));
  if (!windows || windows.length === 0) {
    return { mode: 'general', perDay: false, start: '10:00', end: '14:00', days };
  }
  for (const w of windows) {
    days[w.day_of_week] = { enabled: true, start: w.start_time.slice(0, 5), end: w.end_time.slice(0, 5) };
  }
  const first = windows[0];
  const sameEveryDay =
    windows.length === 7 &&
    windows.every((w) => w.start_time === first.start_time && w.end_time === first.end_time);
  return {
    mode: 'specific',
    perDay: !sameEveryDay,
    start: first.start_time.slice(0, 5),
    end: first.end_time.slice(0, 5),
    days,
  };
}

/**
 * The payload for `available_hours`, or an error message. `null` = general availability.
 *
 * "Same hours every day" is stored as one window per weekday; the server intersects each with
 * the admin's working hours, so days the admin does not work still offer nothing.
 */
export function windowsFromDraft(
  draft: SessionHoursDraft
): { windows: SessionTimeWindow[] | null; error?: undefined } | { error: string } {
  if (draft.mode === 'general') return { windows: null };

  const check = (start: string, end: string, label: string) => {
    if (!start || !end) return `${label}Start and end time are required.`;
    if (end <= start) return `${label}End time must be after start time.`;
    return null;
  };

  if (!draft.perDay) {
    const problem = check(draft.start, draft.end, '');
    if (problem) return { error: problem };
    return { windows: ALL_DAYS.map((d) => ({ day_of_week: d, start_time: draft.start, end_time: draft.end })) };
  }

  const windows: SessionTimeWindow[] = [];
  for (const d of DAY_ORDER) {
    const day = draft.days[d];
    if (!day.enabled) continue;
    const problem = check(day.start, day.end, `${DAYS_SHORT[d]}: `);
    if (problem) return { error: problem };
    windows.push({ day_of_week: d, start_time: day.start, end_time: day.end });
  }
  if (windows.length === 0) return { error: 'Choose at least one day for this meeting type.' };
  return { windows };
}

export function SessionHoursField({
  value,
  onChange,
}: {
  value: SessionHoursDraft;
  onChange: (next: SessionHoursDraft) => void;
}) {
  const set = (patch: Partial<SessionHoursDraft>) => onChange({ ...value, ...patch });
  const setDay = (d: number, patch: Partial<SessionHoursDraft['days'][number]>) =>
    set({ days: value.days.map((day, i) => (i === d ? { ...day, ...patch } : day)) });

  const singleInvalid = value.mode === 'specific' && !value.perDay && !!value.start && !!value.end && value.end <= value.start;

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-text-primary">Available time</legend>

      <div className="space-y-2">
        {([
          ['general', 'Use my general availability'],
          ['specific', 'Set specific hours'],
        ] as const).map(([mode, label]) => (
          <label
            key={mode}
            className={cn(
              'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm',
              value.mode === mode ? 'border-primary-300 bg-primary-50/50' : 'border-border'
            )}
          >
            <input
              type="radio"
              name="session-hours-mode"
              value={mode}
              checked={value.mode === mode}
              onChange={() => set({ mode })}
              className="h-4 w-4 accent-primary-600"
            />
            {label}
          </label>
        ))}
      </div>

      {value.mode === 'specific' && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          {!value.perDay ? (
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mt-hours-start">Start time</Label>
                <Input
                  id="mt-hours-start"
                  type="time"
                  value={value.start}
                  onChange={(e) => set({ start: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mt-hours-end">End time</Label>
                <Input
                  id="mt-hours-end"
                  type="time"
                  value={value.end}
                  aria-invalid={singleInvalid || undefined}
                  onChange={(e) => set({ end: e.target.value })}
                />
              </div>
              {singleInvalid && (
                <p className="text-xs font-medium text-red-600 min-[400px]:col-span-2" role="alert">
                  End time must be after start time.
                </p>
              )}
            </div>
          ) : (
            <ul className="space-y-2">
              {DAY_ORDER.map((d) => {
                const day = value.days[d];
                const invalid = day.enabled && !!day.start && !!day.end && day.end <= day.start;
                return (
                  <li key={d} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <label className="flex min-h-11 w-20 cursor-pointer items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={day.enabled}
                        onChange={(e) => setDay(d, { enabled: e.target.checked })}
                        className="h-4 w-4 accent-primary-600"
                      />
                      {DAYS_SHORT[d]}
                    </label>
                    {day.enabled ? (
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Input
                          type="time"
                          aria-label={`${DAYS_SHORT[d]} start time`}
                          value={day.start}
                          onChange={(e) => setDay(d, { start: e.target.value })}
                          className="min-w-0"
                        />
                        <span className="text-text-tertiary" aria-hidden="true">→</span>
                        <Input
                          type="time"
                          aria-label={`${DAYS_SHORT[d]} end time`}
                          aria-invalid={invalid || undefined}
                          value={day.end}
                          onChange={(e) => setDay(d, { end: e.target.value })}
                          className="min-w-0"
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-text-tertiary">Not offered</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.perDay}
              onChange={(e) => {
                if (e.target.checked) {
                  // Start every day from the hours already entered rather than from blank rows.
                  const anyEnabled = value.days.some((day) => day.enabled);
                  set({
                    perDay: true,
                    days: anyEnabled
                      ? value.days
                      : value.days.map(() => ({ enabled: true, start: value.start, end: value.end })),
                  });
                } else {
                  const first = DAY_ORDER.map((d) => value.days[d]).find((day) => day.enabled);
                  set({ perDay: false, start: first?.start || value.start, end: first?.end || value.end });
                }
              }}
              className="h-4 w-4 accent-primary-600"
            />
            Different hours on different days
          </label>
          <p className="text-xs text-text-tertiary">
            Only times that are also inside your working hours can be booked.
          </p>
        </div>
      )}
    </fieldset>
  );
}
