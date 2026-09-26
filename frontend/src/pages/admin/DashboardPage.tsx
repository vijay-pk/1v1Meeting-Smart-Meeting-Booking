import { useState, useEffect } from 'react';
import { StatsCard } from '@/components/common/StatsCard';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonList, SkeletonStats } from '@/components/common/Skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/stores/authStore';
import { formatPrice, parseBookingWallClock, wallClockNow } from '@/lib/format';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import {
  CalendarDays,
  Clock,
  CreditCard,
  Users,
  TrendingUp,
  XCircle,
  Video,
  ArrowRight,
  ExternalLink,
  CheckCircle2,
  Circle,
  Share2,
  Lock,
  EyeIcon,
  Plus,
  MapPin,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { Booking, DashboardStats } from '@/types';
import { ErrorNote } from '@/components/common/ErrorNote';
import { PublicLinkRow, usePublicLinkShare } from '@/components/admin/PublicLink';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { ONBOARDING_STEPS, isStepDone } from '@/lib/onboarding';

export function DashboardPage() {
  const { profile } = useAuthStore();
  const navigate = useNavigate();
  // Hides the card for this visit only. It changes no step and writes nothing.
  const [dismissedChecklist, setDismissedChecklist] = useState(false);

  // Every step, the count and the username for the public link come from the server.
  const { status: onboarding, error: onboardingError, loading: onboardingLoading, refresh } =
    useOnboardingStatus();
  const { url: publicUrl, state: shareState, share, inputRef } = usePublicLinkShare(onboarding?.username);

  // First-time setup comes before the dashboard. An admin who has finished it once is never
  // sent back, even if a step later regresses -- the checklist below shows that instead.
  useEffect(() => {
    if (onboarding && onboarding.role === 'admin' && !onboarding.setup_completed) {
      navigate('/admin/setup', { replace: true });
    }
  }, [onboarding, navigate]);

  const completedSteps = onboarding?.completed_count ?? 0;
  const totalSteps = onboarding?.total_count ?? ONBOARDING_STEPS.length;
  const allComplete = !!onboarding && completedSteps === totalSteps;
  const showChecklist = !!onboarding && !allComplete && !dismissedChecklist;

  const handleShare = () => {
    if (!publicUrl) {
      navigate('/admin/settings');
      return;
    }
    void share();
  };

  // Stats and upcoming meetings from the backend the booking flow writes to. This used to
  // count the browser store (always empty, and "revenue" was a hardcoded ₹1,497 per booking)
  // and read upcoming meetings from the separate Supabase database, so a real booking never
  // appeared here.
  const [stats, setStats] = useState<DashboardStats>({
    todays_meetings: 0,
    upcoming_meetings: 0,
    total_bookings: 0,
    total_revenue: 0,
    pending_payments: 0,
    cancelled_meetings: 0,
    currency: 'INR',
  });
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
  const [bookingsError, setBookingsError] = useState('');
  const [loading] = useState(false);

  const loadBookings = () => {
    setBookingsError('');
    api
      .getMyBookings()
      .then((rows: any[]) => {
        const all = Array.isArray(rows) ? rows : [];
        // Booking times are wall clock in the booking's timezone, so "now" and "today" are
        // taken in that zone too -- never the browser's.
        const zone = all[0]?.timezone || 'Asia/Kolkata';
        const now = wallClockNow(zone);
        const today = format(now, 'yyyy-MM-dd');
        const confirmed = all.filter((b) => b.status === 'confirmed');
        const upcoming = confirmed
          .filter((b) => parseBookingWallClock(b.start_time) >= now)
          .sort((a, b) => parseBookingWallClock(a.start_time).getTime() - parseBookingWallClock(b.start_time).getTime());

        setStats({
          todays_meetings: confirmed.filter((b) => String(b.start_time).slice(0, 10) === today).length,
          upcoming_meetings: upcoming.length,
          // Abandoned checkouts are not bookings.
          total_bookings: all.filter((b) => !['pending_payment', 'expired'].includes(b.status)).length,
          // Real, captured payments only; simulated test payments are not revenue.
          total_revenue: all
            .filter((b) => b.payment_status === 'completed')
            .reduce((sum, b) => sum + (Number(b.price) || 0), 0),
          pending_payments: 0,
          cancelled_meetings: all.filter((b) => b.status === 'cancelled').length,
          currency: 'INR',
        });
        setUpcomingBookings(
          upcoming.slice(0, 5).map((b) => ({
            id: b.id,
            status: b.status,
            start_time: b.start_time,
            end_time: b.end_time,
            google_meet_url: b.google_meet_link,
            customer: { name: b.client_name, email: b.client_email },
            meeting_type: { name: b.session_title },
          })) as unknown as Booking[]
        );
      })
      .catch((err: any) => setBookingsError(err?.message || 'Could not load your bookings.'));
  };

  useEffect(() => {
    loadBookings();
  }, []);

  if (loading) {
    return (
      <div className="space-y-5">
        <SkeletonStats count={4} />
        <SkeletonList rows={4} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Dashboard"
        description={
          profile?.full_name?.trim()
            ? `Welcome back, ${profile.full_name.trim()}`
            : 'Welcome back'
        }
        actions={
          <Link to="/admin/bookings">
            <Button variant="outline" size="touch">
              View all bookings
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        }
      />

      {onboardingError && !onboarding && (
        <ErrorNote message={`Couldn't load your setup status. ${onboardingError}`} onRetry={() => void refresh()} />
      )}
      {bookingsError && (
        <ErrorNote message={`Couldn't load your bookings. ${bookingsError}`} onRetry={loadBookings} />
      )}

      {/* Setup Checklist */}
      {showChecklist && (
        <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-blue-900">Get Ready to Take Bookings</CardTitle>
              <button
                onClick={() => setDismissedChecklist(true)}
                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
              >
                Dismiss
              </button>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-2 mt-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
              ></div>
            </div>
            <p className="text-xs text-blue-700 mt-1">{completedSteps} of {totalSteps} complete</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ONBOARDING_STEPS.map((step) => {
                const done = isStepDone(onboarding, step.key);
                return (
                  <Link key={step.key} to={step.link}>
                    <div className="p-3 rounded-lg bg-white hover:bg-blue-100 transition cursor-pointer">
                      <div className="flex items-center gap-2 mb-1">
                        {done ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Circle className="w-4 h-4 text-blue-400" />
                        )}
                        <p className="text-xs font-semibold text-text-primary">{step.label}</p>
                      </div>
                      <p className="text-[10px] text-text-tertiary">{done ? 'Done' : 'Complete this'}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Action Bar */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Button
            type="button"
            onClick={handleShare}
            disabled={!onboarding}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            size="sm"
          >
            <Share2 className="w-4 h-4" />
            Share Link
          </Button>
          <Link to="/admin/settings/availability">
            <Button variant="outline" className="w-full" size="sm">
              <Lock className="w-4 h-4" />
              Block Time
            </Button>
          </Link>
          {publicUrl ? (
            // A plain anchor to the absolute public URL: the same page and API a client
            // gets, opened without the admin's session mattering at all.
            <a href={publicUrl} target="_blank" rel="noopener noreferrer">
              <Button type="button" variant="outline" className="w-full" size="sm" tabIndex={-1}>
                <EyeIcon className="w-4 h-4" />
                Preview
              </Button>
            </a>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              size="sm"
              disabled={!onboarding}
              onClick={() => navigate('/admin/settings')}
            >
              <EyeIcon className="w-4 h-4" />
              Preview
            </Button>
          )}
          <Link to="/admin/settings/meeting-types">
            <Button variant="outline" className="w-full" size="sm">
              <Plus className="w-4 h-4" />
              New Meeting
            </Button>
          </Link>
        </div>
        <PublicLinkRow
          url={publicUrl}
          state={shareState}
          inputRef={inputRef}
          loading={onboardingLoading && !onboarding}
          error={onboarding ? '' : onboardingError}
          onRetry={() => void refresh()}
        />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatsCard
          title="Today's Meetings"
          value={stats.todays_meetings}
          icon={<CalendarDays className="w-5 h-5" />}
          iconBg="bg-blue-50 text-blue-600"
        />
        <StatsCard
          title="Upcoming"
          value={stats.upcoming_meetings}
          icon={<Clock className="w-5 h-5" />}
          iconBg="bg-emerald-50 text-emerald-600"
        />
        <StatsCard
          title="Total Revenue"
          value={formatPrice(stats.total_revenue, stats.currency)}
          icon={<TrendingUp className="w-5 h-5" />}
          iconBg="bg-purple-50 text-purple-600"
        />
        <StatsCard
          title="Cancelled"
          value={stats.cancelled_meetings}
          icon={<XCircle className="w-5 h-5" />}
          iconBg="bg-red-50 text-red-600"
        />
      </div>

      {/* Next Meeting Hero Card */}
      {upcomingBookings.length > 0 && (
        <Card className="bg-gradient-to-r from-primary-50 to-primary-100 border-primary-200">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-primary-700 mb-2">Your Next Meeting</p>
                <h3 className="text-2xl font-bold text-text-primary mb-1">
                  {upcomingBookings[0].customer?.name || 'Client'}
                </h3>
                <p className="text-sm text-text-secondary mb-3">
                  {upcomingBookings[0].meeting_type?.name} • {format(parseBookingWallClock(upcomingBookings[0].start_time), 'EEE, MMM d · h:mm a')}
                </p>
                {upcomingBookings[0].notes && (
                  <p className="text-xs text-text-tertiary mb-3">Notes: {upcomingBookings[0].notes}</p>
                )}
              </div>
              <div className="flex gap-2">
                {upcomingBookings[0].google_meet_url && (
                  <a
                    href={upcomingBookings[0].google_meet_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg flex items-center gap-2"
                  >
                    <Video className="w-4 h-4" />
                    Join Meet
                  </a>
                )}
                {/* There is no per-booking route; the bookings list holds the details. */}
                <Link to="/admin/bookings">
                  <Button variant="outline" size="sm">
                    Details
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upcoming Meetings List */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-text-secondary" />
              Upcoming Meetings
            </CardTitle>
            <Link to="/admin/bookings">
              <Button variant="ghost" size="sm">
                View all
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {upcomingBookings.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No upcoming meetings"
              description="Share your booking page to get bookings."
              action={
                publicUrl ? (
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="touch" tabIndex={-1}>
                      <ExternalLink className="w-3.5 h-3.5" />
                      View booking page
                    </Button>
                  </a>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-3">
              {upcomingBookings.slice(1).map((booking) => (
                <Link
                  key={booking.id}
                  to="/admin/bookings"
                  className="press flex flex-col gap-3 rounded-xl border border-border p-4 transition-all duration-150 hover:border-primary-200 hover:bg-primary-50/30 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary-100 text-primary-700 font-semibold text-sm shrink-0">
                      {booking.customer?.name
                        ? booking.customer.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .toUpperCase()
                            .slice(0, 2)
                        : '??'}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-text-primary truncate">
                        {booking.customer?.name || 'Unknown Customer'}
                      </p>
                      <p className="text-sm text-text-secondary truncate">
                        {booking.meeting_type?.name || 'Meeting'}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-3 pl-13 sm:gap-4 sm:pl-0">
                    <div className="hidden text-right sm:block">
                      <p className="text-sm font-medium text-text-primary">
                        {format(parseBookingWallClock(booking.start_time), 'MMM d')}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {format(parseBookingWallClock(booking.start_time), 'h:mm a')}
                      </p>
                    </div>
                    <StatusBadge status={booking.status} />
                    {booking.google_meet_url && (
                      <a
                        href={booking.google_meet_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="press inline-flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-primary-50 hover:text-primary-600"
                        title="Join Google Meet"
                        aria-label="Join Google Meet"
                      >
                        <Video className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-text-secondary" />
              Total Bookings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold text-text-primary">{stats.total_bookings}</p>
            <p className="text-sm text-text-secondary mt-1">All time bookings</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-text-secondary" />
              Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold text-text-primary">
              {formatPrice(stats.total_revenue, stats.currency)}
            </p>
            <p className="text-sm text-text-secondary mt-1">Total earned</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
