import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { CURRENCIES, CALENDAR_COLORS } from '@/lib/constants';
import type { MeetingType, Currency } from '@/types';
import {
  Plus,
  Edit2,
  Trash2,
  Video,
  Clock,
  DollarSign,
  GripVertical,
  AlertCircle,
  Check,
} from 'lucide-react';

const DEFAULT_MEETING: Partial<MeetingType> = {
  name: '',
  description: '',
  duration_minutes: 30,
  price: 99900,
  currency: 'INR',
  is_active: true,
  buffer_before_minutes: 0,
  buffer_after_minutes: 10,
  min_advance_hours: 2,
  max_advance_days: 60,
  cancellation_window_hours: 24,
  reschedule_allowed: true,
  max_bookings_per_day: null,
  color_id: 7,
  sort_order: 0,
};

export function MeetingTypesPage() {
  const { profile } = useAuthStore();
  const [meetingTypes, setMeetingTypes] = useState<MeetingType[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<Partial<MeetingType> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchMeetingTypes = async () => {
    try {
      const apiSessions = await api.getMySessions();
      if (apiSessions && apiSessions.length > 0) {
        setMeetingTypes(apiSessions.map((s: any) => ({
          id: s.id,
          admin_id: s.admin_id || profile?.id || '',
          name: s.title,
          description: s.description || '',
          duration_minutes: s.duration_minutes,
          price: s.price,
          original_price: s.original_price,
          offer_price: s.price,
          currency: (s.currency || 'INR') as Currency,
          is_active: s.is_active,
          buffer_before_minutes: s.buffer_before_minutes || 0,
          buffer_after_minutes: s.buffer_after_minutes || 0,
          min_advance_hours: s.min_advance_hours || 2,
          max_advance_days: s.max_advance_days || 60,
          cancellation_window_hours: 24,
          reschedule_allowed: true,
          color_id: 1,
          sort_order: s.sort_order || 1,
          created_at: s.created_at || new Date().toISOString(),
          updated_at: s.updated_at || new Date().toISOString(),
        })));
        setLoading(false);
        return;
      }
    } catch (e) {}

    if (!profile?.id) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('meeting_types')
      .select('*')
      .eq('admin_id', profile.id)
      .order('sort_order', { ascending: true });
    if (data) setMeetingTypes(data as MeetingType[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchMeetingTypes();
  }, [profile?.id]);

  const openCreate = () => {
    setEditingMeeting({ ...DEFAULT_MEETING });
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (meeting: MeetingType) => {
    setEditingMeeting({ ...meeting });
    setError('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editingMeeting) return;
    if (!editingMeeting.name?.trim()) {
      setError('Meeting name is required');
      return;
    }
    if (!editingMeeting.price || editingMeeting.price <= 0) {
      setError('Price must be greater than 0');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        admin_id: profile?.id || 'admin',
        name: editingMeeting.name!.trim(),
        description: editingMeeting.description || '',
        duration_minutes: editingMeeting.duration_minutes || 30,
        price: editingMeeting.price!,
        currency: editingMeeting.currency || 'INR',
        is_active: editingMeeting.is_active ?? true,
        buffer_before_minutes: editingMeeting.buffer_before_minutes || 0,
        buffer_after_minutes: editingMeeting.buffer_after_minutes || 0,
        min_advance_hours: editingMeeting.min_advance_hours || 2,
        max_advance_days: editingMeeting.max_advance_days || 60,
        cancellation_window_hours: editingMeeting.cancellation_window_hours || 24,
        reschedule_allowed: editingMeeting.reschedule_allowed ?? true,
        max_bookings_per_day: editingMeeting.max_bookings_per_day || null,
        color_id: editingMeeting.color_id || 7,
        sort_order: editingMeeting.sort_order || meetingTypes.length,
      };

      // Sync to backend sessions API
      if (editingMeeting.id) {
        await api.updateSession(editingMeeting.id, {
          title: editingMeeting.name!.trim(),
          description: editingMeeting.description || '',
          duration_minutes: editingMeeting.duration_minutes || 30,
          price: editingMeeting.price!,
          original_price: editingMeeting.original_price || null,
          currency: editingMeeting.currency || 'INR',
          is_active: editingMeeting.is_active ?? true,
        }).catch(() => {});

        try {
          await supabase
            .from('meeting_types')
            .update(payload)
            .eq('id', editingMeeting.id);
        } catch (e) {}
      } else {
        await api.createSession({
          title: editingMeeting.name!.trim(),
          description: editingMeeting.description || '',
          duration_minutes: editingMeeting.duration_minutes || 30,
          price: editingMeeting.price!,
          original_price: editingMeeting.original_price || null,
          currency: editingMeeting.currency || 'INR',
          is_active: editingMeeting.is_active ?? true,
        }).catch(() => {});

        try {
          await supabase.from('meeting_types').insert(payload);
        } catch (e) {}
      }

      setDialogOpen(false);
      await fetchMeetingTypes();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this meeting type?')) return;
    await api.deleteSession(id).catch(() => {});
    try {
      await supabase.from('meeting_types').delete().eq('id', id);
    } catch (e) {}
    await fetchMeetingTypes();
  };

  const toggleActive = async (meeting: MeetingType) => {
    await api.updateSession(meeting.id, { is_active: !meeting.is_active }).catch(() => {});
    try {
      await supabase
        .from('meeting_types')
        .update({ is_active: !meeting.is_active })
        .eq('id', meeting.id);
    } catch (e) {}
    await fetchMeetingTypes();
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 bg-white rounded-lg w-48" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-28 bg-white rounded-xl border border-border" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Meeting Types</h1>
          <p className="text-sm text-text-secondary mt-1">
            Configure the services you offer
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4" />
          New Meeting Type
        </Button>
      </div>

      {meetingTypes.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Video className="w-12 h-12 text-text-tertiary mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              No meeting types yet
            </h3>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              Create your first meeting type to start accepting bookings on your public page.
            </p>
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4" />
              Create Meeting Type
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {meetingTypes.map((meeting) => (
            <Card
              key={meeting.id}
              className={`transition-all duration-200 ${
                !meeting.is_active ? 'opacity-60' : 'hover:shadow-card-hover'
              }`}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0 flex-1">
                    <div className="flex items-center gap-2 shrink-0 pt-1">
                      <GripVertical className="w-4 h-4 text-text-tertiary cursor-grab" />
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{
                          backgroundColor:
                            CALENDAR_COLORS.find((c) => c.id === meeting.color_id)?.hex ||
                            '#3b82f6',
                        }}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-text-primary truncate">
                          {meeting.name}
                        </h3>
                        {!meeting.is_active && (
                          <Badge variant="outline" className="text-xs">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      {meeting.description && (
                        <p className="text-sm text-text-secondary line-clamp-2 mb-2">
                          {meeting.description}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {meeting.duration_minutes} min
                        </span>
                        <span className="flex items-center gap-1">
                          <DollarSign className="w-3.5 h-3.5" />
                          {formatPrice(meeting.price, meeting.currency as Currency)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Video className="w-3.5 h-3.5" />
                          Google Meet
                        </span>
                        {meeting.buffer_after_minutes > 0 && (
                          <span>Buffer: {meeting.buffer_after_minutes}min after</span>
                        )}
                        {meeting.reschedule_allowed && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            Reschedule allowed
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={meeting.is_active}
                      onCheckedChange={() => toggleActive(meeting)}
                      aria-label={meeting.is_active ? 'Deactivate' : 'Activate'}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEdit(meeting)}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(meeting.id)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingMeeting?.id ? 'Edit Meeting Type' : 'New Meeting Type'}
            </DialogTitle>
            <DialogDescription>
              Configure the details for this meeting type
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="flex items-center gap-2 p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mt-name">Meeting Name *</Label>
              <Input
                id="mt-name"
                placeholder="30-Minute Developer Consultation"
                value={editingMeeting?.name || ''}
                onChange={(e) =>
                  setEditingMeeting((m) => ({ ...m, name: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mt-description">Description</Label>
              <Textarea
                id="mt-description"
                placeholder="Describe what this meeting covers..."
                value={editingMeeting?.description || ''}
                onChange={(e) =>
                  setEditingMeeting((m) => ({ ...m, description: e.target.value }))
                }
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mt-duration">Duration (minutes)</Label>
                <Select
                  value={String(editingMeeting?.duration_minutes || 30)}
                  onValueChange={(v) =>
                    setEditingMeeting((m) => ({ ...m, duration_minutes: parseInt(v) }))
                  }
                >
                  <SelectTrigger id="mt-duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 minutes</SelectItem>
                    <SelectItem value="30">30 minutes</SelectItem>
                    <SelectItem value="45">45 minutes</SelectItem>
                    <SelectItem value="60">60 minutes</SelectItem>
                    <SelectItem value="90">90 minutes</SelectItem>
                    <SelectItem value="120">120 minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mt-currency">Currency</Label>
                <Select
                  value={editingMeeting?.currency || 'INR'}
                  onValueChange={(v) =>
                    setEditingMeeting((m) => ({ ...m, currency: v as Currency }))
                  }
                >
                  <SelectTrigger id="mt-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CURRENCIES).map(([code, info]) => (
                      <SelectItem key={code} value={code}>
                        {info.symbol} {info.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mt-price">
                Price ({CURRENCIES[editingMeeting?.currency || 'INR']?.symbol})
              </Label>
              <Input
                id="mt-price"
                type="text"
                inputMode="numeric"
                placeholder="999"
                value={
                  editingMeeting?.price
                    ? String(Math.floor(editingMeeting.price / 100))
                    : ''
                }
                onChange={(e) => {
                  const clean = e.target.value.replace(/[^0-9]/g, '');
                  setEditingMeeting((m) => ({
                    ...m,
                    price: clean === '' ? 0 : parseInt(clean, 10) * 100,
                  }));
                }}
              />
              <p className="text-xs text-text-tertiary">
                Customer will pay{' '}
                {editingMeeting?.price
                  ? formatPrice(
                      editingMeeting.price,
                      (editingMeeting.currency as Currency) || 'INR'
                    )
                  : '₹0'}
              </p>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mt-buffer-before">Buffer before (min)</Label>
                <Input
                  id="mt-buffer-before"
                  type="number"
                  value={editingMeeting?.buffer_before_minutes || 0}
                  onChange={(e) =>
                    setEditingMeeting((m) => ({
                      ...m,
                      buffer_before_minutes: parseInt(e.target.value) || 0,
                    }))
                  }
                  min="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mt-buffer-after">Buffer after (min)</Label>
                <Input
                  id="mt-buffer-after"
                  type="number"
                  value={editingMeeting?.buffer_after_minutes || 0}
                  onChange={(e) =>
                    setEditingMeeting((m) => ({
                      ...m,
                      buffer_after_minutes: parseInt(e.target.value) || 0,
                    }))
                  }
                  min="0"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mt-advance">Min advance notice (hours)</Label>
                <Input
                  id="mt-advance"
                  type="number"
                  value={editingMeeting?.min_advance_hours || 2}
                  onChange={(e) =>
                    setEditingMeeting((m) => ({
                      ...m,
                      min_advance_hours: parseInt(e.target.value) || 2,
                    }))
                  }
                  min="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mt-horizon">Max booking horizon (days)</Label>
                <Input
                  id="mt-horizon"
                  type="number"
                  value={editingMeeting?.max_advance_days || 60}
                  onChange={(e) =>
                    setEditingMeeting((m) => ({
                      ...m,
                      max_advance_days: parseInt(e.target.value) || 60,
                    }))
                  }
                  min="1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mt-cancel-window">Cancellation window (hours)</Label>
                <Input
                  id="mt-cancel-window"
                  type="number"
                  value={editingMeeting?.cancellation_window_hours || 24}
                  onChange={(e) =>
                    setEditingMeeting((m) => ({
                      ...m,
                      cancellation_window_hours: parseInt(e.target.value) || 24,
                    }))
                  }
                  min="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mt-max-daily">Max bookings/day</Label>
                <Input
                  id="mt-max-daily"
                  type="number"
                  placeholder="Unlimited"
                  value={editingMeeting?.max_bookings_per_day ?? ''}
                  onChange={(e) =>
                    setEditingMeeting((m) => ({
                      ...m,
                      max_bookings_per_day: e.target.value
                        ? parseInt(e.target.value)
                        : null,
                    }))
                  }
                  min="1"
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border border-border">
              <div>
                <p className="text-sm font-medium">Allow rescheduling</p>
                <p className="text-xs text-text-tertiary">
                  Customers can reschedule their booking
                </p>
              </div>
              <Switch
                checked={editingMeeting?.reschedule_allowed ?? true}
                onCheckedChange={(checked) =>
                  setEditingMeeting((m) => ({ ...m, reschedule_allowed: checked }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Calendar Color</Label>
              <div className="flex flex-wrap gap-2">
                {CALENDAR_COLORS.map((color) => (
                  <button
                    key={color.id}
                    type="button"
                    onClick={() =>
                      setEditingMeeting((m) => ({ ...m, color_id: color.id }))
                    }
                    className={`w-8 h-8 rounded-full transition-all cursor-pointer ${
                      editingMeeting?.color_id === color.id
                        ? 'ring-2 ring-offset-2 ring-primary-500 scale-110'
                        : 'hover:scale-110'
                    }`}
                    style={{ backgroundColor: color.hex }}
                    title={color.name}
                  >
                    {editingMeeting?.color_id === color.id && (
                      <Check className="w-4 h-4 text-white mx-auto" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : editingMeeting?.id ? (
                'Save Changes'
              ) : (
                'Create Meeting Type'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
