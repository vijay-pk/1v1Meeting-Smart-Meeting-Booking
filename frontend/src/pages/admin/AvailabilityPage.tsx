import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/common/PageHeader';
import { Spinner } from '@/components/common/Skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '@/stores/authStore';
import { useBookingStore } from '@/stores/bookingStore';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import { TIMEZONES } from '@/lib/constants';
import type { AvailabilityException } from '@/types';
import { Clock, Trash2, Save, Calendar, Check, Sparkles } from 'lucide-react';

const DAYS_ORDER = [
  { index: 1, name: 'Mon', fullName: 'Monday' },
  { index: 2, name: 'Tue', fullName: 'Tuesday' },
  { index: 3, name: 'Wed', fullName: 'Wednesday' },
  { index: 4, name: 'Thu', fullName: 'Thursday' },
  { index: 5, name: 'Fri', fullName: 'Friday' },
  { index: 6, name: 'Sat', fullName: 'Saturday' },
  { index: 0, name: 'Sun', fullName: 'Sunday' },
];

const TIME_OPTIONS = [
  '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30',
  '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00'
];

export function AvailabilityPage() {
  const { profile, updateProfile } = useAuthStore();
  const { scheduleBlocks, addScheduleBlock, removeScheduleBlock } = useBookingStore();

  const adminId = profile?.id || localStorage.getItem('bmm_logged_admin_id') || 'admin';
  const adminName = profile?.full_name || localStorage.getItem('bmm_logged_admin_name') || 'Your';

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

  // Load initial availability from store and backend
  useEffect(() => {
    const loadAvailability = async () => {
      try {
        // 1. Fetch from FastAPI backend
        const rules = await api.getMyAvailabilityRules();
        if (Array.isArray(rules) && rules.length > 0) {
          // Sync with local booking store
          const currentStoreBlocks = useBookingStore.getState().scheduleBlocks.filter(b => b.admin_id !== adminId);
          const newBlocks = rules.map((r: any, idx: number) => ({
            id: `rule-${adminId}-${r.day_of_week}-${idx}`,
            admin_id: adminId,
            day_of_week: r.day_of_week,
            start_time: r.start_time.slice(0, 5),
            end_time: r.end_time.slice(0, 5),
            is_active: r.is_active ?? true,
          }));
          useBookingStore.setState({ scheduleBlocks: [...currentStoreBlocks, ...newBlocks] });
        }

        // 2. Fetch exceptions from Supabase
        if (adminId) {
          const { data: excs } = await supabase
            .from('availability_exceptions')
            .select('*')
            .eq('admin_id', adminId)
            .order('exception_date', { ascending: true });
          if (excs) setExceptions(excs as AvailabilityException[]);
        }
      } catch (err) {
        console.warn('Could not load backend rules, using store defaults:', err);
      } finally {
        setLoading(false);
      }
    };

    loadAvailability();
  }, [adminId]);

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
    if (current.start >= current.end) {
      alert('End time must be after start time.');
      return;
    }

    addScheduleBlock(adminId, dayIndex, current.start, current.end);
  };

  const handleApplyPreset = (preset: 'standard' | 'extended' | 'clear') => {
    const remaining = scheduleBlocks.filter(b => b.admin_id !== adminId);

    if (preset === 'clear') {
      useBookingStore.setState({ scheduleBlocks: remaining });
      return;
    }

    const start = preset === 'standard' ? '09:00' : '10:00';
    const end = preset === 'standard' ? '17:00' : '18:00';

    const newBlocks = [1, 2, 3, 4, 5].map((dayIndex, idx) => ({
      id: `preset-${adminId}-${dayIndex}-${Date.now()}-${idx}`,
      admin_id: adminId,
      day_of_week: dayIndex,
      start_time: start,
      end_time: end,
      is_active: true
    }));

    useBookingStore.setState({ scheduleBlocks: [...remaining, ...newBlocks] });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);

    try {
      const myBlocks = scheduleBlocks.filter(b => b.admin_id === adminId && b.is_active);

      // 1. Persist to FastAPI backend rules table
      const ruleItems = myBlocks.map(b => ({
        day_of_week: b.day_of_week,
        start_time: b.start_time.length === 5 ? `${b.start_time}:00` : b.start_time,
        end_time: b.end_time.length === 5 ? `${b.end_time}:00` : b.end_time,
        is_active: true
      }));

      try {
        await api.saveMyAvailabilityRules(ruleItems);
      } catch (err) {
        console.warn('FastAPI availability save error:', err);
      }

      // 2. Also save to Supabase if connected
      if (adminId) {
        try {
          await supabase.from('availability_rules').delete().eq('admin_id', adminId);
          if (ruleItems.length > 0) {
            await supabase.from('availability_rules').insert(
              ruleItems.map(r => ({ admin_id: adminId, ...r }))
            );
          }
        } catch (sbErr) {
          console.warn('Supabase availability save error:', sbErr);
        }
      }

      // 3. Update profile timezone
      if (timezone !== profile?.timezone) {
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
    if (!adminId || !newException.date) return;

    try {
      const { data, error } = await supabase.from('availability_exceptions').insert({
        admin_id: adminId,
        exception_date: newException.date,
        is_available: false,
        reason: newException.reason || null,
      }).select();

      if (!error && data) {
        setExceptions(prev => [...prev, ...data]);
        setNewException({ date: '', reason: '' });
      }
    } catch (e) {
      console.warn('Exception add error:', e);
    }
  };

  const removeException = async (id: string) => {
    try {
      await supabase.from('availability_exceptions').delete().eq('id', id);
      setExceptions(prev => prev.filter(e => e.id !== id));
    } catch (e) {
      console.warn('Exception delete error:', e);
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

      {/* Quick Schedule Presets */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-surface-secondary/60 rounded-xl border border-border text-xs">
        <span className="font-semibold text-text-secondary flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span>Quick Presets:</span>
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleApplyPreset('standard')}
          className="h-7 text-[11px] rounded-lg border-border hover:bg-surface"
        >
          Weekdays 9 AM – 5 PM
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleApplyPreset('extended')}
          className="h-7 text-[11px] rounded-lg border-border hover:bg-surface"
        >
          Weekdays 10 AM – 6 PM
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
            const blocksForDay = scheduleBlocks.filter(
              (b) => b.admin_id === adminId && b.day_of_week === day.index && b.is_active
            );
            const currentNew = dayNewBlocks[day.index] || { start: '09:00', end: '17:00' };

            return (
              <div key={day.index} className="py-4 first:pt-0 last:pb-0 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-text-primary w-20">
                    {day.name}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {blocksForDay.length === 0 ? (
                    <span className="text-xs text-text-tertiary italic py-1 mr-2">
                      No hours set
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
                          onClick={() => removeScheduleBlock(block.id)}
                          className="text-red-500 hover:text-red-700 ml-1 font-bold text-xs cursor-pointer"
                          title="Remove time block"
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}

                  {/* Add Block Form */}
                  <div className="flex items-center gap-2 mt-1 sm:mt-0">
                    <Select
                      value={currentNew.start}
                      onValueChange={(val) => handleTimeChange(day.index, 'start', val)}
                    >
                      <SelectTrigger className="w-24 h-9 text-xs rounded-lg bg-surface border-border">
                        <SelectValue placeholder="Start" />
                      </SelectTrigger>
                      <SelectContent className="max-h-56">
                        {TIME_OPTIONS.map((t) => (
                          <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <span className="text-xs text-text-tertiary font-medium">to</span>

                    <Select
                      value={currentNew.end}
                      onValueChange={(val) => handleTimeChange(day.index, 'end', val)}
                    >
                      <SelectTrigger className="w-24 h-9 text-xs rounded-lg bg-surface border-border">
                        <SelectValue placeholder="End" />
                      </SelectTrigger>
                      <SelectContent className="max-h-56">
                        {TIME_OPTIONS.map((t) => (
                          <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

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
