import { Minus, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DAYS_SHORT } from '@/lib/constants';
import { cn } from '@/lib/utils';

export interface SessionTimeWindow {
  day_of_week: number; // 0 = Sunday ... 6 = Saturday
  start_time: string; // HH:MM
  end_time: string; // HH:MM
}

/** One bookable window on a day, "HH:MM" wall clock in the host's business timezone. */
export interface TimeRange {
  start: string;
  end: string;
}

export interface SessionHoursDraft {
  mode: 'general' | 'specific';
  perDay: boolean;
  windows: TimeRange[]; // same windows every day
  days: { enabled: boolean; windows: TimeRange[] }[]; // index = day_of_week
}

// Mirrors MAX_WINDOWS_PER_DAY in backend/app/api/sessions.py.
export const MAX_WINDOWS_PER_DAY = 10;

// Monday first, as the Availability page reads.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_RANGE: TimeRange = { start: '10:00', end: '12:00' };

const byStart = (a: TimeRange, b: TimeRange) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end);
const sameRanges = (a: TimeRange[], b: TimeRange[]) =>
  a.length === b.length && a.every((r, i) => r.start === b[i].start && r.end === b[i].end);

/** Builds the form state from what the server stored. No windows = general availability. */
export function draftFromWindows(windows: SessionTimeWindow[] | null | undefined): SessionHoursDraft {
  const days = ALL_DAYS.map(() => ({ enabled: false, windows: [{ ...DEFAULT_RANGE }] }));
  if (!windows || windows.length === 0) {
    return { mode: 'general', perDay: false, windows: [{ ...DEFAULT_RANGE }], days };
  }
  const grouped: TimeRange[][] = ALL_DAYS.map(() => []);
  for (const w of windows) {
    grouped[w.day_of_week].push({ start: w.start_time.slice(0, 5), end: w.end_time.slice(0, 5) });
  }
  grouped.forEach((ranges, d) => {
    ranges.sort(byStart);
    if (ranges.length) days[d] = { enabled: true, windows: ranges };
  });
  // "Same hours every day" is stored as identical windows on all seven weekdays.
  const sameEveryDay = grouped.every((ranges) => ranges.length > 0 && sameRanges(ranges, grouped[0]));
  const first = DAY_ORDER.map((d) => grouped[d]).find((ranges) => ranges.length) ?? [{ ...DEFAULT_RANGE }];
  return {
    mode: 'specific',
    perDay: !sameEveryDay,
    windows: first.map((r) => ({ ...r })),
    days,
  };
}

/** What is wrong with one day's windows, or null. Windows may touch but not overlap or repeat. */
export function rangesProblem(ranges: TimeRange[]): string | null {
  if (ranges.length === 0) return 'Add at least one time window.';
  if (ranges.length > MAX_WINDOWS_PER_DAY) return `At most ${MAX_WINDOWS_PER_DAY} time windows per day.`;
  for (const r of ranges) {
    if (!r.start || !r.end) return 'Start and end time are required.';
    if (r.end <= r.start) return 'End time must be after start time.';
  }
  const sorted = [...ranges].sort(byStart);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.start === cur.start && prev.end === cur.end) return 'The same time window is listed twice.';
    if (cur.start < prev.end) return 'Time windows cannot overlap.';
  }
  return null;
}

/**
 * The payload for `available_hours`, or an error message. `null` = general availability.
 *
 * "Same hours every day" is stored as the same windows on every weekday; the server intersects
 * each with the admin's working hours, so days the admin does not work still offer nothing.
 * Windows are sent sorted and never merged.
 */
export function windowsFromDraft(
  draft: SessionHoursDraft
): { windows: SessionTimeWindow[] | null; error?: undefined } | { error: string } {
  if (draft.mode === 'general') return { windows: null };

  const toRows = (d: number, ranges: TimeRange[]) =>
    [...ranges].sort(byStart).map((r) => ({ day_of_week: d, start_time: r.start, end_time: r.end }));

  if (!draft.perDay) {
    const problem = rangesProblem(draft.windows);
    if (problem) return { error: problem };
    return { windows: ALL_DAYS.flatMap((d) => toRows(d, draft.windows)) };
  }

  const windows: SessionTimeWindow[] = [];
  for (const d of DAY_ORDER) {
    const day = draft.days[d];
    if (!day.enabled) continue;
    const problem = rangesProblem(day.windows);
    if (problem) return { error: `${DAYS_SHORT[d]}: ${problem}` };
    windows.push(...toRows(d, day.windows));
  }
  if (windows.length === 0) return { error: 'Choose at least one day for this meeting type.' };
  return { windows };
}

/** A sensible next window: starting where the last one ends, one hour long. */
function nextRange(ranges: TimeRange[]): TimeRange {
  const last = [...ranges].sort(byStart).at(-1);
  if (!last || !last.end) return { ...DEFAULT_RANGE };
  const [h, m] = last.end.split(':').map(Number);
  const endMinutes = Math.min(h * 60 + m + 60, 23 * 60 + 59);
  const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  return end > last.end ? { start: last.end, end } : { ...DEFAULT_RANGE };
}

/** Only flags what is actually wrong once both ends are filled, so typing is not shouted at. */
function visibleProblem(ranges: TimeRange[]): string | null {
  if (ranges.some((r) => !r.start || !r.end)) return null;
  return rangesProblem(ranges);
}

function TimeWindowList({
  ranges,
  onChange,
  label,
}: {
  ranges: TimeRange[];
  onChange: (next: TimeRange[]) => void;
  label: string;
}) {
  const problem = visibleProblem(ranges);
  const update = (i: number, patch: Partial<TimeRange>) =>
    onChange(ranges.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="min-w-0 flex-1 space-y-2">
      <ul className="space-y-2">
        {ranges.map((r, i) => {
          const rowLabel = `${label} window ${i + 1}`;
          const invalid = !!r.start && !!r.end && r.end <= r.start;
          return (
            <li key={i} className="flex items-center gap-2">
              <Input
                type="time"
                aria-label={`${rowLabel} start time`}
                value={r.start}
                onChange={(e) => update(i, { start: e.target.value })}
                className="min-w-0"
              />
              <span className="text-text-tertiary" aria-hidden="true">→</span>
              <Input
                type="time"
                aria-label={`${rowLabel} end time`}
                aria-invalid={invalid || undefined}
                value={r.end}
                onChange={(e) => update(i, { end: e.target.value })}
                className="min-w-0"
              />
              <button
                type="button"
                onClick={() => onChange(ranges.filter((_, j) => j !== i))}
                disabled={ranges.length <= 1}
                aria-label={`Remove ${rowLabel}`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-text-secondary hover:bg-surface-tertiary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Minus className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>
      {problem && (
        <p className="text-xs font-medium text-red-600" role="alert">
          {problem}
        </p>
      )}
      {ranges.length < MAX_WINDOWS_PER_DAY && (
        <button
          type="button"
          onClick={() => onChange([...ranges, nextRange(ranges)])}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          <Plus className="h-4 w-4" />
          Add another time
        </button>
      )}
    </div>
  );
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
  const copy = (ranges: TimeRange[]) => ranges.map((r) => ({ ...r }));

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
            <div className="space-y-2">
              <p className="text-xs font-medium text-text-secondary">Time windows</p>
              <TimeWindowList
                ranges={value.windows}
                onChange={(windows) => set({ windows })}
                label="Time"
              />
            </div>
          ) : (
            <ul className="space-y-3">
              {DAY_ORDER.map((d) => {
                const day = value.days[d];
                return (
                  <li key={d} className="flex flex-wrap items-start gap-x-3 gap-y-1">
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
                      <TimeWindowList
                        ranges={day.windows}
                        onChange={(windows) => setDay(d, { windows })}
                        label={DAYS_SHORT[d]}
                      />
                    ) : (
                      <span className="flex min-h-11 items-center text-xs text-text-tertiary">Not offered</span>
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
                  // Start every day from the windows already entered rather than from blank rows.
                  const anyEnabled = value.days.some((day) => day.enabled);
                  set({
                    perDay: true,
                    days: anyEnabled
                      ? value.days
                      : value.days.map(() => ({ enabled: true, windows: copy(value.windows) })),
                  });
                } else {
                  const first = DAY_ORDER.map((d) => value.days[d]).find((day) => day.enabled);
                  set({ perDay: false, windows: first ? copy(first.windows) : value.windows });
                }
              }}
              className="h-4 w-4 accent-primary-600"
            />
            Different hours on different days
          </label>
          <p className="text-xs text-text-tertiary">
            Times are in your business timezone. Only times that are also inside your working hours can be
            booked.
          </p>
        </div>
      )}
    </fieldset>
  );
}
