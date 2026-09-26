import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/common/PageHeader';
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
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { CURRENCIES } from '@/lib/constants';
import {
  SessionHoursField,
  draftFromWindows,
  windowsFromDraft,
  type SessionHoursDraft,
} from '@/components/admin/SessionHoursField';
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
} from 'lucide-react';

const DEFAULT_MEETING: Partial<MeetingType> = {
  name: '',
  description: '',
  duration_minutes: 30,
  // No suggested price. A prefilled amount is a price nobody chose, and the admin has to
  // notice and overwrite it; an empty field plus the "must be greater than 0" check makes
  // every price an explicit decision.
  price: 0,
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
  const [hoursDraft, setHoursDraft] = useState<SessionHoursDraft>(() => draftFromWindows(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchMeetingTypes = async () => {
    setLoading(true);
    setError('');
    try {
      // The FastAPI `sessions` table is the only source of truth for prices. This used to
      // fall back to the Supabase `meeting_types` table whenever the API returned nothing or
      // threw, and every save wrote to both -- so the two could hold different prices and the
      // page showed whichever answered first.
      const apiSessions = await api.getMySessions();
      setMeetingTypes(
        (Array.isArray(apiSessions) ? apiSessions : []).map((s: any) => ({
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
          available_hours: s.available_hours ?? null,
          created_at: s.created_at || new Date().toISOString(),
          updated_at: s.updated_at || new Date().toISOString(),
        })) as MeetingType[]
      );
    } catch (e: any) {
      setError(e?.message || 'Could not load your meeting types. Your saved prices are unchanged.');
      setMeetingTypes([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeetingTypes();
  }, [profile?.id]);

  const openCreate = () => {
    setEditingMeeting({ ...DEFAULT_MEETING });
    setHoursDraft(draftFromWindows(null));
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (meeting: MeetingType) => {
    setEditingMeeting({ ...meeting });
    // Loaded from the saved rows, so editing never resets a window that exists.
    setHoursDraft(draftFromWindows(meeting.available_hours));
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

    const hours = windowsFromDraft(hoursDraft);
    if ('error' in hours && hours.error) {
      setError(hours.error);
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        title: editingMeeting.name!.trim(),
        description: editingMeeting.description || '',
        duration_minutes: editingMeeting.duration_minutes || 30,
        price: editingMeeting.price!,
        original_price: editingMeeting.original_price || null,
        currency: editingMeeting.currency || 'INR',
        is_active: editingMeeting.is_active ?? true,
        available_hours: 'windows' in hours ? hours.windows : null,
      };

      // Not swallowed: a rejected save must be shown, not hidden behind a refetch that
      // redisplays the old price as though the edit had never been made.
      if (editingMeeting.id) {
        await api.updateSession(editingMeeting.id, payload);
      } else {
        await api.createSession(payload);
      }

      setDialogOpen(false);
      await fetchMeetingTypes();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save. Your saved price is unchanged.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this meeting type?')) return;
    setError('');
    try {
      await api.deleteSession(id);
    } catch (e: any) {
      setError(e?.message || 'Could not delete that meeting type.');
    }
    await fetchMeetingTypes();
  };

  const toggleActive = async (meeting: MeetingType) => {
    setError('');
    try {
      // Only `is_active` is sent. A partial update cannot disturb the stored price.
      await api.updateSession(meeting.id, { is_active: !meeting.is_active });
    } catch (e: any) {
      setError(e?.message || 'Could not change that meeting type.');
    }
    await fetchMeetingTypes();
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 bg-surface rounded-lg w-48" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-28 bg-surface rounded-xl border border-border" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Meeting Types"
        description="Sessions you offer"
        actions={
          <Button onClick={openCreate} size="touch" className="w-full sm:w-auto">
            <Plus className="w-4 h-4" />
            New Meeting Type
          </Button>
        }
      />

      {/* A load failure must be visible on the page, not only inside the edit dialog:
          otherwise an empty list reads as "you have no meeting types". */}
      {error && !dialogOpen && (
        <div className="flex items-start gap-2 p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {meetingTypes.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Video className="w-12 h-12 text-text-tertiary mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              No meeting types yet
            </h3>
            <p className="text-text-secondary mb-6 max-w-md mx-auto">
              Add a meeting type to start taking bookings.
            </p>
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4" />
              Add Meeting
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
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="flex items-start gap-4 min-w-0 flex-1">
                    <div className="flex items-center gap-2 shrink-0 pt-1">
                      <GripVertical className="w-4 h-4 text-text-tertiary cursor-grab" />
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
                        {meeting.available_hours && meeting.available_hours.length > 0 && (
                          <span>Specific hours</span>
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
                      size="icon-touch"
                      onClick={() => openEdit(meeting)}
                      aria-label={`Edit ${meeting.name}`}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-touch"
                      onClick={() => handleDelete(meeting.id)}
                      aria-label={`Delete ${meeting.name}`}
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
            <DialogDescription className="sr-only">
              Name, duration, price and when this meeting type can be booked
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
              <Label htmlFor="mt-name">Name *</Label>
              <Input
                id="mt-name"
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
                value={editingMeeting?.description || ''}
                onChange={(e) =>
                  setEditingMeeting((m) => ({ ...m, description: e.target.value }))
                }
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                Customer pays{' '}
                {editingMeeting?.price
                  ? formatPrice(
                      editingMeeting.price,
                      (editingMeeting.currency as Currency) || 'INR'
                    )
                  : '₹0'}
              </p>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border border-border">
              <div>
                <p className="text-sm font-medium">Allow rescheduling</p>
                <p className="text-xs text-text-tertiary">
                  Customers can reschedule.
                </p>
              </div>
              <Switch
                aria-label="Allow rescheduling"
                checked={editingMeeting?.reschedule_allowed ?? true}
                onCheckedChange={(checked) =>
                  setEditingMeeting((m) => ({ ...m, reschedule_allowed: checked }))
                }
              />
            </div>

            <Separator />

            <SessionHoursField value={hoursDraft} onChange={setHoursDraft} />
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
