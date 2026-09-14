import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/common/PageHeader';
import { Spinner } from '@/components/common/Skeleton';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { TIMEZONES } from '@/lib/constants';
import type { AvailabilityException } from '@/types';
import { Clock, Trash2, Save, Calendar, Check, Sparkles, Copy, AlertCircle } from 'lucide-react';

const DAYS_ORDER = [
  { index: 1, name: 'Mon', fullName: 'Monday' },
  { index: 2, name: 'Tue', fullName: 'Tuesday' },
  { index: 3, name: 'Wed', fullName: 'Wednesday' },
  { index: 4, name: 'Thu', fullName: 'Thursday' },
  { index: 5, name: 'Fri', fullName: 'Friday' },
  { index: 6, name: 'Sat', fullName: 'Saturday' },
  { index: 0, name: 'Sun', fullName: 'Sunday' },
];


/** A working-hours window as the page holds it in memory. */
interface DayBlock {
  id: string;
  day_of_week: number;
  start_time: string; // HH:MM
  end_time: string;   // HH:MM
}

export function AvailabilityPage() {
  const { profile, updateProfile } = useAuthStore();

  const adminName = profile?.full_name || localStorage.getItem('bmm_logged_admin_name') || 'Your';

  // Working hours live here, loaded from and saved to the backend. They used to live in the
  // persisted zustand store keyed by a client-derived admin id: when that id changed between
  // renders (the auth store falls back to `admin-<username>` before the profile hydrates),
  // the filter matched nothing and the page reported "No hours set" while the database held
  // the rows all along.
  const [blocks, setBlocks] = useState<DayBlock[]>([]);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');

  const [timezone, setTimezone] = useState(profile?.timezone || 'Asia/Kolkata');
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newException, setNewException] = useState({ date: '', reason: '' });

  // Temporary selectors for adding blocks on each day
  const [dayNewBlocks, setDayNewBlocks] = useState<Record<number, { start: string; end: string }>>({
    1: { start: '09:00', end: '17:00' },
    2: { start: '09:00', end: '17:00' },
    3: { start: '09:00', end: '17:00' },
    4: { start: '09:00', end: '17:00' },
    5: { start: '09:00', end: '17:00' },
    6: { start: '10:00', end: '14:00' },
    0: { start: '10:00', end: '14:00' },
  });

  // Vacation mode state
  const [vacationMode, setVacationMode] = useState(false);
  const [vacationStart, setVacationStart] = useState('');
  const [vacationEnd, setVacationEnd] = useState('');

  // Load everything from the backend on mount. No localStorage, no seeded defaults: an
  // empty result means the admin genuinely has no hours yet, and a failure says so.
  const loadAvailability = React.useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [rules, excs] = await Promise.all([
        api.getMyAvailabilityRules(),
        api.getMyAvailabilityExceptions(),
      ]);

      setBlocks(
        (Array.isArray(rules) ? rules : [])
          .filter((r: any) => r.is_active !== false)
          .map((r: any, index: number) => ({
            id: `rule-${r.day_of_week}-${r.start_time}-${index}`,
            day_of_week: r.day_of_week,
            start_time: String(r.start_time).slice(0, 5),
            end_time: String(r.end_time).slice(0, 5),
          }))
      );
      setExceptions(Array.isArray(excs) ? (excs as AvailabilityException[]) : []);
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load your availability. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  const handleTimeChange = (dayIndex: number, field: 'start' | 'end', val: string) => {
    setDayNewBlocks(prev => ({
      ...prev,
      [dayIndex]: {
        ...(prev[dayIndex] || { start: '09:00', end: '17:00' }),
        [field]: val
      }
    }));
  };

  const handleAddBlock = (dayIndex: number) => {
    const current = dayNewBlocks[dayIndex] || { start: '09:00', end: '17:00' };
    if (!current.start || !current.end) {
      setSaveError('Enter both a start and an end time.');
      return;
    }
    if (current.start >= current.end) {
      setSaveError('End time must be after start time.');
      return;
    }
    setSaveError('');

    const duplicate = blocks.some(
      (b) =>
        b.day_of_week === dayIndex &&
        b.start_time === current.start &&
        b.end_time === current.end
    );
    if (duplicate) return;

    setBlocks((prev) => [
      ...prev,
      {
        id: `new-${dayIndex}-${current.start}-${Date.now()}`,
        day_of_week: dayIndex,
        start_time: current.start,
        end_time: current.end,
      },
    ]);
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  };

  const handleApplyPreset = (preset: 'business' | 'morning' | 'evening' | 'clear') => {
    if (preset === 'clear') {
      setBlocks([]);
      return;
    }

    let presetBlocks: DayBlock[] = [];
    switch (preset) {
      case 'business':
        presetBlocks = [1, 2, 3, 4, 5].map((dayIndex, idx) => ({
          id: `preset-${dayIndex}-${Date.now()}-${idx}`,
          day_of_week: dayIndex,
          start_time: '09:00',
          end_time: '17:00',
        }));
        break;
      case 'morning':
        presetBlocks = [1, 2, 3, 4, 5, 6].map((dayIndex, idx) => ({
          id: `preset-${dayIndex}-${Date.now()}-${idx}`,
          day_of_week: dayIndex,
          start_time: '08:00',
          end_time: '13:00',
        }));
        break;
      case 'evening':
        presetBlocks = [
          ...([1, 2, 3, 4, 5].map((dayIndex, idx) => ({
            id: `preset-${dayIndex}-${Date.now()}-${idx}`,
            day_of_week: dayIndex,
            start_time: '18:00',
            end_time: '21:00',
          }))),
          ...([6, 0].map((dayIndex, idx) => ({
            id: `preset-${dayIndex}-${Date.now()}-${idx + 5}`,
            day_of_week: dayIndex,
            start_time: '10:00',
            end_time: '16:00',
          }))),
        ];
        break;
    }
    setBlocks(presetBlocks);
  };

  const handleCopyToWeekdays = () => {
    const mondayBlocks = blocks.filter((b) => b.day_of_week === 1);
    if (mondayBlocks.length === 0) return;

    const newBlocks = [...blocks.filter((b) => b.day_of_week !== 1)];
    for (let dayIndex = 2; dayIndex <= 5; dayIndex++) {
      for (const mondayBlock of mondayBlocks) {
        newBlocks.push({
          id: `copied-${dayIndex}-${Date.now()}`,
          day_of_week: dayIndex,
          start_time: mondayBlock.start_time,
          end_time: mondayBlock.end_time,
        });
      }
    }
    setBlocks(newBlocks);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError('');

    try {
      const ruleItems = blocks.map((b) => ({
        day_of_week: b.day_of_week,
        // Canonical HH:MM. The page previously appended ":00", and the slot engine parses
        // "%H:%M", so those rows could not be read back into bookable hours.
        start_time: b.start_time.slice(0, 5),
        end_time: b.end_time.slice(0, 5),
        is_active: true,
      }));

      // No try/catch swallow here: if this throws, the admin sees the failure instead of a
      // "Saved" badge over data that never reached the database.
      await api.saveMyAvailabilityRules(ruleItems);

      if (timezone !== profile?.timezone) {
        await updateProfile({ timezone });
      }

      // Adopt what the server actually stored, so the UI can never drift from it.
      await loadAvailability();

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error: any) {
      setSaveError(error?.message || 'Could not save your availability. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const addException = async () => {
    if (!newException.date) return;
    setSaveError('');
    try {
      const created = await api.addMyAvailabilityException({
        exception_date: newException.date,
        reason: newException.reason || null,
      });
      setExceptions((prev) => [...prev, created as AvailabilityException]);
      setNewException({ date: '', reason: '' });
    } catch (e: any) {
      setSaveError(e?.message || 'Could not block that date.');
    }
  };

  const removeException = async (id: string) => {
    setSaveError('');
    try {
      await api.deleteMyAvailabilityException(id);
      setExceptions((prev) => prev.filter((e) => e.id !== id));
    } catch (e: any) {
      setSaveError(e?.message || 'Could not remove that blocked date.');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 bg-surface rounded-xl border border-border" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <PageHeader
        title={`${adminName} — Weekly Hours`}
        description="Set daily availability time blocks for your personal booking portal."
        actions={
          <Button onClick={handleSave} disabled={saving} size="touch" className="w-full sm:w-auto bg-[#0B1E3B] hover:bg-slate-800 text-white font-semibold">
            {saving ? (
              <Spinner />
            ) : saved ? (
              <>
                <Check className="w-4 h-4 mr-1.5 text-emerald-400" />
                Saved Successfully
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-1.5" />
                Save Changes
              </>
            )}
          </Button>
        }
      />

      {loadError && <ErrorNote message={loadError} onRetry={loadAvailability} />}
      {saveError && <ErrorNote message={saveError} />}

      {/* Quick Schedule Presets */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-surface-secondary/60 rounded-xl border border-border text-xs">
        <span className="font-semibold text-text-secondary flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span>Quick Presets:</span>
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleApplyPreset('business')}
          className="h-7 text-[11px] rounded-lg border-border hover:bg-surface"
        >
          Business (9 AM – 5 PM)
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleApplyPreset('morning')}
          className="h-7 text-[11px] rounded-lg border-border hover:bg-surface"
        >
          Morning Shifts (8 AM – 1 PM)
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleApplyPreset('evening')}
          className="h-7 text-[11px] rounded-lg border-border hover:bg-surface"
        >
          Evenings & Weekends
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleApplyPreset('clear')}
          className="h-7 text-[11px] text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
        >
          Clear All Hours
        </Button>
      </div>

      {/* Weekly Hours By Day */}
      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-base font-bold text-text-primary">Daily Availability Blocks</CardTitle>
          <CardDescription>
            Add multiple time blocks for each day. Clients can only book slots within these hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 divide-y divide-border">
          {DAYS_ORDER.map((day) => {
            const blocksForDay = blocks.filter((b) => b.day_of_week === day.index);
            const currentNew = dayNewBlocks[day.index] || { start: '09:00', end: '17:00' };

            return (
              <div key={day.index} className="py-4 first:pt-0 last:pb-0 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-text-primary w-20">
                    {day.name}
                  </span>
                  {day.index === 1 && blocksForDay.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyToWeekdays}
                      className="h-6 text-[10px] text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20 flex items-center gap-1"
                      title="Apply Monday hours to Tue–Fri"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy to weekdays</span>
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {blocksForDay.length === 0 ? (
                    <span className="text-xs text-text-tertiary italic py-1 mr-2">
                      {loadError ? 'Could not load' : 'No hours set'}
                    </span>
                  ) : (
                    blocksForDay.map((block) => (
                      <div
                        key={block.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-tertiary text-text-primary text-xs font-semibold border border-border shadow-2xs"
                      >
                        <span>{block.start_time} - {block.end_time}</span>
                        <button
                          type="button"
                          onClick={() => removeBlock(block.id)}
                          className="text-red-500 hover:text-red-700 ml-1 font-bold text-xs cursor-pointer"
                          title="Remove time block"
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}

                  {/* Add Block Form.
                      Free time entry rather than a fixed 30-minute dropdown, so any start
                      and end can be typed (or picked from the browser's own time control). */}
                  <div className="flex items-center gap-2 mt-1 sm:mt-0">
                    <Input
                      type="time"
                      aria-label={`${day.fullName} start time`}
                      value={currentNew.start}
                      onChange={(e) => handleTimeChange(day.index, 'start', e.target.value)}
                      className="w-28 h-9 text-xs rounded-lg bg-surface border-border"
                    />

                    <span className="text-xs text-text-tertiary font-medium">to</span>

                    <Input
                      type="time"
                      aria-label={`${day.fullName} end time`}
                      value={currentNew.end}
                      onChange={(e) => handleTimeChange(day.index, 'end', e.target.value)}
                      className="w-28 h-9 text-xs rounded-lg bg-surface border-border"
                    />

                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleAddBlock(day.index)}
                      className="bg-[#0B1E3B] hover:bg-slate-800 text-white text-xs h-9 px-3.5 rounded-lg font-semibold cursor-pointer shadow-2xs"
                    >
                      + Add block
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Timezone */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-text-secondary" />
            Timezone
          </CardTitle>
          <CardDescription>
            All your slot calculations will be computed in this timezone
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger className="w-full sm:w-80 h-10 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value} className="text-xs">
                  {tz.label} ({tz.offset})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Vacation Mode */}
      <Card className={vacationMode ? 'border-amber-200 bg-amber-50/40 dark:bg-amber-950/10' : ''}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {vacationMode && <AlertCircle className="w-4 h-4 text-amber-600" />}
              <CardTitle className="text-base">Vacation Mode</CardTitle>
            </div>
            <Switch
              checked={vacationMode}
              onCheckedChange={setVacationMode}
              aria-label="Toggle vacation mode"
            />
          </div>
          <CardDescription>
            {vacationMode
              ? 'No slots will be available to book during this period'
              : 'Toggle to block all bookings during a specific date range'}
          </CardDescription>
        </CardHeader>
        {vacationMode && (
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="vacation-start" className="text-xs">From Date</Label>
                <Input
                  id="vacation-start"
                  type="date"
                  value={vacationStart}
                  onChange={(e) => setVacationStart(e.target.value)}
                  className="h-10 text-xs"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="vacation-end" className="text-xs">To Date</Label>
                <Input
                  id="vacation-end"
                  type="date"
                  value={vacationEnd}
                  onChange={(e) => setVacationEnd(e.target.value)}
                  className="h-10 text-xs"
                  required
                />
              </div>
            </div>
            {vacationStart && vacationEnd && (
              <div className="p-2 bg-white dark:bg-slate-900 rounded-lg text-xs text-text-secondary border border-border">
                Vacation: {new Date(vacationStart).toLocaleDateString()} – {new Date(vacationEnd).toLocaleDateString()}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Exceptions / Holidays */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="w-4 h-4 text-text-secondary" />
            Date Exceptions & Vacation Days
          </CardTitle>
          <CardDescription>
            Block specific dates on which you won't accept any appointments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="space-y-1 sm:w-44 sm:shrink-0">
              <Label htmlFor="exc-date" className="text-xs">Date</Label>
              <Input
                id="exc-date"
                type="date"
                value={newException.date}
                onChange={(e) =>
                  setNewException((prev) => ({ ...prev, date: e.target.value }))
                }
                className="h-10 w-full text-xs"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="exc-reason" className="text-xs">Reason (optional)</Label>
              <Input
                id="exc-reason"
                placeholder="Holiday, personal leave, conference, etc."
                value={newException.reason}
                onChange={(e) =>
                  setNewException((prev) => ({ ...prev, reason: e.target.value }))
                }
                className="h-10 text-xs"
              />
            </div>
            <Button
              type="button"
              onClick={addException}
              disabled={!newException.date}
              className="h-10 text-xs px-4 bg-[#0B1E3B] text-white"
            >
              Block Date
            </Button>
          </div>

          {exceptions.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-border">
              {exceptions.map((exc) => (
                <div
                  key={exc.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface text-xs"
                >
                  <div>
                    <span className="font-semibold text-text-primary mr-2">
                      {new Date(exc.exception_date).toLocaleDateString(undefined, {
                        weekday: 'short',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    {exc.reason && (
                      <span className="text-text-tertiary">({exc.reason})</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeException(exc.id)}
                    className="h-7 text-xs text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
