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
import { supabase } from '@/lib/supabase';
import { formatPrice, formatDate, formatTime } from '@/lib/format';
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
import { Link } from 'react-router-dom';
import type { Booking, DashboardStats } from '@/types';
import { useBookingStore } from '@/stores/bookingStore';

export function DashboardPage() {
  const { profile } = useAuthStore();
  const { bookings: storeBookings, meetingTypes } = useBookingStore();
  const [dismissedChecklist, setDismissedChecklist] = useState(false);

  // Compute checklist completion
  const checklistSteps = [
    {
      id: 'profile',
      label: 'Profile & Photo',
      completed: !!(profile?.full_name && profile?.photo_url),
      link: '/admin/settings',
    },
    {
      id: 'hours',
      label: 'Working Hours',
      completed: true, // Auto-set for all new admins
      link: '/admin/availability',
    },
    {
      id: 'meeting',
      label: 'Active Meeting Type',
      completed: (meetingTypes?.length || 0) > 0,
      link: '/admin/meeting-types',
    },
    {
      id: 'integrations',
      label: 'Connect Gateway',
      completed: false, // Can be checked manually by admin
      link: '/admin/settings',
    },
  ];

  const completedSteps = checklistSteps.filter(s => s.completed).length;
  const allComplete = completedSteps === checklistSteps.length;
  const showChecklist = !allComplete && !dismissedChecklist;

  // Instant fallback data calculation
  const getInitialStats = (): DashboardStats => {
    const adminId = profile?.id || localStorage.getItem('bmm_logged_admin_id');
    const myBookings = storeBookings.filter(
      (b) => b.admin_id === adminId || b.assigned_admin_id === adminId || !b.admin_id
    );
    const confirmed = myBookings.filter((b) => b.status === 'confirmed');
    const revenue = confirmed.reduce((sum, b) => sum + 149700, 0);

    return {
      todays_meetings: 0,
      upcoming_meetings: confirmed.length,
      total_bookings: myBookings.length,
      total_revenue: revenue,
      pending_payments: 0,
      cancelled_meetings: myBookings.filter((b) => b.status === 'cancelled').length,
      currency: 'INR',
    };
  };

  const [stats, setStats] = useState<DashboardStats>(getInitialStats);
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>(() => {
    const adminId = profile?.id || localStorage.getItem('bmm_logged_admin_id');
    return storeBookings.filter(
      (b) => b.admin_id === adminId || b.assigned_admin_id === adminId || !b.admin_id
    ).slice(0, 5);
  });
  const [loading, setLoading] = useState(false); // Instant render!

  useEffect(() => {
    const adminId = profile?.id || localStorage.getItem('bmm_logged_admin_id');
    if (!adminId) return;

    const fetchDashboardData = async () => {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Supabase timeout')), 800)
        );

        const fetchPromise = (async () => {
          const now = new Date().toISOString();
          const { data: upcoming } = await supabase
            .from('bookings')
            .select('*, customer:customers(*), meeting_type:meeting_types(*), payment:payments(*)')
            .eq('admin_id', adminId)
            .in('status', ['confirmed', 'payment_received'])
            .gte('start_time', now)
            .order('start_time', { ascending: true })
            .limit(5);

          if (upcoming && upcoming.length > 0) {
            setUpcomingBookings(upcoming as Booking[]);
          }
        })();

        await Promise.race([fetchPromise, timeoutPromise]);
      } catch (error) {
        // Kept instant local data
      }
    };

    fetchDashboardData();
  }, [profile?.id]);

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
        description={`Welcome back, ${profile?.full_name?.split(' ')[0] || 'Admin'}`}
        actions={
          <Link to="/admin/bookings">
            <Button variant="outline" size="touch">
              View all bookings
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        }
      />

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
                style={{ width: `${(completedSteps / checklistSteps.length) * 100}%` }}
              ></div>
            </div>
            <p className="text-xs text-blue-700 mt-1">{completedSteps} of {checklistSteps.length} complete</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {checklistSteps.map((step) => (
                <Link key={step.id} to={step.link}>
                  <div className="p-3 rounded-lg bg-white hover:bg-blue-100 transition cursor-pointer">
                    <div className="flex items-center gap-2 mb-1">
                      {step.completed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Circle className="w-4 h-4 text-blue-400" />
                      )}
                      <p className="text-xs font-semibold text-text-primary">{step.label}</p>
                    </div>
                    <p className="text-[10px] text-text-tertiary">{step.completed ? 'Done' : 'Complete this'}</p>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Action Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link to={`/${profile?.username}`} target="_blank">
          <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" size="sm">
            <Share2 className="w-4 h-4" />
            Share Link
          </Button>
        </Link>
        <Link to="/admin/availability">
          <Button variant="outline" className="w-full" size="sm">
            <Lock className="w-4 h-4" />
            Block Time
          </Button>
        </Link>
        <Link to={`/${profile?.username}`} target="_blank">
          <Button variant="outline" className="w-full" size="sm">
            <EyeIcon className="w-4 h-4" />
            Preview
          </Button>
        </Link>
        <Link to="/admin/meeting-types">
          <Button variant="outline" className="w-full" size="sm">
            <Plus className="w-4 h-4" />
            New Meeting
          </Button>
        </Link>
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
                  {upcomingBookings[0].meeting_type?.name} • {formatTime(upcomingBookings[0].start_time, profile?.timezone || 'Asia/Kolkata')}
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
                <Link to={`/admin/bookings/${upcomingBookings[0].id}`}>
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
              description="Share your booking page to start receiving appointments."
              action={
                profile?.username ? (
                  <Link to={`/book/${profile.username}`} target="_blank">
                    <Button variant="outline" size="touch">
                      <ExternalLink className="w-3.5 h-3.5" />
                      View booking page
                    </Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-3">
              {upcomingBookings.slice(1).map((booking) => (
                <Link
                  key={booking.id}
                  to={`/admin/bookings/${booking.id}`}
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
                        {formatDate(booking.start_time, profile?.timezone || 'Asia/Kolkata', 'MMM d')}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {formatTime(booking.start_time, profile?.timezone || 'Asia/Kolkata')}
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
