import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Skeleton';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { DAYS_OF_WEEK, TIMEZONES } from '@/lib/constants';
import type { AvailabilityRule, AvailabilityException } from '@/types';
import { Clock, Plus, Trash2, Save, Calendar, AlertCircle, Check } from 'lucide-react';

interface DayConfig {
  day: number;
  dayName: string;
  windows: { id?: string; start: string; end: string; active: boolean }[];
  isActive: boolean;
}

export function AvailabilityPage() {
  const { profile, updateProfile } = useAuthStore();
  const [dayConfigs, setDayConfigs] = useState<DayConfig[]>([]);
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
  const [timezone, setTimezone] = useState(profile?.timezone || 'Asia/Kolkata');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newException, setNewException] = useState({ date: '', reason: '' });

  useEffect(() => {
    if (!profile?.id) return;

    const fetchAvailability = async () => {
      const { data: rules } = await supabase
        .from('availability_rules')
        .select('*')
        .eq('admin_id', profile.id)
        .order('day_of_week', { ascending: true });

      const { data: excs } = await supabase
        .from('availability_exceptions')
        .select('*')
        .eq('admin_id', profile.id)
        .order('exception_date', { ascending: true });

      // Build day configs
      const configs: DayConfig[] = DAYS_OF_WEEK.map((dayName, index) => {
        const dayRules = (rules as AvailabilityRule[] | null)?.filter(
          (r) => r.day_of_week === index
        ) || [];
        return {
          day: index,
          dayName,
          isActive: dayRules.some((r) => r.is_active),
          windows:
            dayRules.length > 0
              ? dayRules.map((r) => ({
                  id: r.id,
                  start: r.start_time.slice(0, 5),
                  end: r.end_time.slice(0, 5),
                  active: r.is_active,
                }))
              : [{ start: '10:00', end: '18:00', active: false }],
        };
      });

      setDayConfigs(configs);
      setExceptions((excs as AvailabilityException[]) || []);
      setLoading(false);
    };

    fetchAvailability();
  }, [profile?.id]);

  const toggleDay = (dayIndex: number) => {
    setDayConfigs((prev) =>
      prev.map((dc) =>
        dc.day === dayIndex
          ? {
              ...dc,
              isActive: !dc.isActive,
              windows: dc.windows.map((w) => ({ ...w, active: !dc.isActive })),
            }
          : dc
      )
    );
  };

  const updateWindow = (dayIndex: number, windowIndex: number, field: 'start' | 'end', value: string) => {
    setDayConfigs((prev) =>
      prev.map((dc) =>
        dc.day === dayIndex
          ? {
              ...dc,
              windows: dc.windows.map((w, i) =>
                i === windowIndex ? { ...w, [field]: value } : w
              ),
            }
          : dc
      )
    );
  };

  const addWindow = (dayIndex: number) => {
    setDayConfigs((prev) =>
      prev.map((dc) =>
        dc.day === dayIndex
          ? {
              ...dc,
              windows: [...dc.windows, { start: '14:00', end: '18:00', active: true }],
            }
          : dc
      )
    );
  };

  const removeWindow = (dayIndex: number, windowIndex: number) => {
    setDayConfigs((prev) =>
      prev.map((dc) =>
        dc.day === dayIndex
          ? {
              ...dc,
              windows: dc.windows.filter((_, i) => i !== windowIndex),
            }
          : dc
      )
    );
  };

  const handleSave = async () => {
    if (!profile?.id) return;
    setSaving(true);
    setSaved(false);

    try {
      // Delete existing rules
      await supabase
        .from('availability_rules')
        .delete()
        .eq('admin_id', profile.id);

      // Insert new rules
      const rules = dayConfigs.flatMap((dc) =>
        dc.windows.map((w) => ({
          admin_id: profile.id,
          day_of_week: dc.day,
          start_time: w.start + ':00',
          end_time: w.end + ':00',
          is_active: dc.isActive && w.active !== false,
        }))
      );

      if (rules.length > 0) {
        await supabase.from('availability_rules').insert(rules);
      }

      // Update timezone
      if (timezone !== profile.timezone) {
        await updateProfile({ timezone });
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Error saving availability:', error);
    } finally {
      setSaving(false);
    }
  };

  const addException = async () => {
    if (!profile?.id || !newException.date) return;

    const { error } = await supabase.from('availability_exceptions').insert({
      admin_id: profile.id,
      exception_date: newException.date,
      is_available: false,
      reason: newException.reason || null,
    });

    if (!error) {
      const { data } = await supabase
        .from('availability_exceptions')
        .select('*')
        .eq('admin_id', profile.id)
        .order('exception_date', { ascending: true });
      setExceptions((data as AvailabilityException[]) || []);
      setNewException({ date: '', reason: '' });
    }
  };

  const removeException = async (id: string) => {
    await supabase.from('availability_exceptions').delete().eq('id', id);
    setExceptions((prev) => prev.filter((e) => e.id !== id));
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
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <PageHeader
        title="Availability"
        description="Set your weekly schedule and timezone"
        actions={
          <Button onClick={handleSave} disabled={saving} size="touch" className="w-full sm:w-auto">
          {saving ? (
            <Spinner />
          ) : saved ? (
            <>
              <Check className="w-4 h-4" />
              Saved
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Changes
            </>
          )}
          </Button>
        }
      />

      {/* Timezone */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-text-secondary" />
            Timezone
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label} ({tz.offset})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Weekly Schedule */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Weekly Schedule</CardTitle>
          <CardDescription>
            Configure your available hours for each day of the week
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {dayConfigs.map((dc) => (
            <div
              key={dc.day}
              className={`p-4 rounded-lg border transition-colors ${
                dc.isActive ? 'border-border bg-surface' : 'border-border bg-surface-secondary'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={dc.isActive}
                    onCheckedChange={() => toggleDay(dc.day)}
                    aria-label={`Toggle ${dc.dayName}`}
                  />
                  <span
                    className={`text-sm font-medium ${
                      dc.isActive ? 'text-text-primary' : 'text-text-tertiary'
                    }`}
                  >
                    {dc.dayName}
                  </span>
                </div>
                {dc.isActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => addWindow(dc.day)}
                    className="text-xs"
                  >
                    <Plus className="w-3 h-3" />
                    Add window
                  </Button>
                )}
              </div>

              {dc.isActive && (
                <div className="space-y-2 sm:ml-12">
                  {dc.windows.map((window, wi) => (
                    // The two time fields now share the row and flex down, instead of each
                    // holding a fixed 128px and forcing ~330px into a 272px column.
                    <div key={wi} className="flex items-center gap-2">
                      <Input
                        type="time"
                        aria-label="Start time"
                        value={window.start}
                        onChange={(e) => updateWindow(dc.day, wi, 'start', e.target.value)}
                        className="h-11 min-w-0 flex-1 text-sm sm:h-9 sm:w-32 sm:flex-none"
                      />
                      <span className="shrink-0 text-sm text-text-tertiary">to</span>
                      <Input
                        type="time"
                        aria-label="End time"
                        value={window.end}
                        onChange={(e) => updateWindow(dc.day, wi, 'end', e.target.value)}
                        className="h-11 min-w-0 flex-1 text-sm sm:h-9 sm:w-32 sm:flex-none"
                      />
                      {dc.windows.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon-touch"
                          onClick={() => removeWindow(dc.day, wi)}
                          className="shrink-0 text-red-400 hover:text-red-600"
                          aria-label="Remove this time window"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!dc.isActive && (
                <p className="text-xs text-text-tertiary sm:ml-12">Unavailable</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Exceptions / Holidays */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="w-4 h-4 text-text-secondary" />
            Date Exceptions
          </CardTitle>
          <CardDescription>
            Block specific dates (holidays, vacations, etc.)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1 sm:w-44 sm:shrink-0">
              <Label htmlFor="exc-date" className="text-xs">Date</Label>
              <Input
                id="exc-date"
                type="date"
                value={newException.date}
                onChange={(e) =>
                  setNewException((prev) => ({ ...prev, date: e.target.value }))
                }
                className="h-11 w-full sm:h-9"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="exc-reason" className="text-xs">Reason (optional)</Label>
              <Input
                id="exc-reason"
                placeholder="Holiday, vacation, etc."
                value={newException.reason}
                onChange={(e) =>
                  setNewException((prev) => ({ ...prev, reason: e.target.value }))
                }
                className="h-11 sm:h-9"
              />
            </div>
            <Button
              size="touch"
              onClick={addException}
              disabled={!newException.date}
              className="w-full sm:w-auto sm:shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </Button>
          </div>

          {exceptions.length === 0 ? (
            <EmptyState
              compact
              icon={Calendar}
              title="No date exceptions"
              description="Add a date above to block it out for a holiday, travel, or anything else."
            />
          ) : (
            <div className="space-y-2">
              {exceptions.map((exc) => (
                <div
                  key={exc.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-red-50/50"
                >
                  <div className="flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-red-500" />
                    <div>
                      <p className="text-sm font-medium text-text-primary">
                        {new Date(exc.exception_date + 'T00:00:00').toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                      {exc.reason && (
                        <p className="text-xs text-text-secondary">{exc.reason}</p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeException(exc.id)}
                    className="text-red-400 hover:text-red-600"
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
