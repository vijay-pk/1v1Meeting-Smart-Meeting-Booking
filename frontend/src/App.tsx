import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

// Layouts

// Admin Pages

// Super Admin Pages

// Auth Pages

// Public Pages
import { AdminLoginPage } from '@/pages/auth/AdminLoginPage';
import { SuperProfileHomePage } from '@/pages/public/SuperProfileHomePage';

// Student Pages

import { warmUpBackend } from '@/lib/api';

// Everything except the sign-in page (the `/` landing page, so it must not wait on a second
// download) and the public booking page loads on demand, so a visitor
// to a booking link does not download the admin, super-admin and student consoles first.
const AdminLayout = lazy(() => import('@/components/layout/AdminLayout').then((m) => ({ default: m.AdminLayout })));
const DashboardPage = lazy(() => import('@/pages/admin/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const BookingsPage = lazy(() => import('@/pages/admin/BookingsPage').then((m) => ({ default: m.BookingsPage })));
const PaymentsPage = lazy(() => import('@/pages/admin/PaymentsPage').then((m) => ({ default: m.PaymentsPage })));
const CustomersPage = lazy(() => import('@/pages/admin/CustomersPage').then((m) => ({ default: m.CustomersPage })));
const SettingsPage = lazy(() => import('@/pages/admin/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SetupPage = lazy(() => import('@/pages/admin/SetupPage').then((m) => ({ default: m.SetupPage })));
const CalendarPage = lazy(() => import('@/pages/admin/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const SuperAdminDashboardPage = lazy(() => import('@/pages/super-admin/SuperAdminDashboardPage').then((m) => ({ default: m.SuperAdminDashboardPage })));
const SuperAdminSettingsPage = lazy(() => import('@/pages/super-admin/SuperAdminSettingsPage').then((m) => ({ default: m.SuperAdminSettingsPage })));
const SuperAdminLoginPage = lazy(() => import('@/pages/auth/SuperAdminLoginPage').then((m) => ({ default: m.SuperAdminLoginPage })));
const SignupPage = lazy(() => import('@/pages/auth/SignupPage').then((m) => ({ default: m.SignupPage })));
const GoogleCallbackPage = lazy(() => import('@/pages/auth/GoogleCallbackPage').then((m) => ({ default: m.GoogleCallbackPage })));
const TimeAvailabilityPage = lazy(() => import('@/pages/public/TimeAvailabilityPage').then((m) => ({ default: m.TimeAvailabilityPage })));
const PaymentCheckoutPage = lazy(() => import('@/pages/public/PaymentCheckoutPage').then((m) => ({ default: m.PaymentCheckoutPage })));
const BookingConfirmationPage = lazy(() => import('@/pages/public/BookingConfirmationPage').then((m) => ({ default: m.BookingConfirmationPage })));
const BookingStatusPage = lazy(() => import('@/pages/public/BookingStatusPage').then((m) => ({ default: m.BookingStatusPage })));
const PrivacyPolicyPage = lazy(() => import('@/pages/public/PrivacyPolicyPage').then((m) => ({ default: m.PrivacyPolicyPage })));
const TermsPage = lazy(() => import('@/pages/public/TermsPage').then((m) => ({ default: m.TermsPage })));
const CancelBookingPage = lazy(() => import('@/pages/public/CancelBookingPage').then((m) => ({ default: m.CancelBookingPage })));
const RescheduleBookingPage = lazy(() => import('@/pages/public/RescheduleBookingPage').then((m) => ({ default: m.RescheduleBookingPage })));
const StudentLayout = lazy(() => import('@/components/layout/StudentLayout').then((m) => ({ default: m.StudentLayout })));
const StudentChangePasswordPage = lazy(() => import('@/pages/student/StudentChangePasswordPage').then((m) => ({ default: m.StudentChangePasswordPage })));
const StudentOverviewPage = lazy(() => import('@/pages/student/StudentOverviewPage').then((m) => ({ default: m.StudentOverviewPage })));
const StudentBookPage = lazy(() => import('@/pages/student/StudentBookPage').then((m) => ({ default: m.StudentBookPage })));
const StudentMeetingsPage = lazy(() => import('@/pages/student/StudentMeetingsPage').then((m) => ({ default: m.StudentMeetingsPage })));
const StudentRecordingsPage = lazy(() => import('@/pages/student/StudentRecordingsPage').then((m) => ({ default: m.StudentRecordingsPage })));

function RouteFallback() {
  return <div className="min-h-screen" aria-busy="true" />;
}

function RedirectWithSearch({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

export const App: React.FC = () => {
  useEffect(() => {
    warmUpBackend();
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Sign In is the front door (Section 7): a fresh visit lands on the login form, with
            a "Sign up" link beneath it. Signup still lives at /signup. */}
        <Route path="/" element={<AdminLoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/book" element={<SuperProfileHomePage />} />
        <Route path="/book/:username" element={<SuperProfileHomePage />} />
        <Route path="/book/:username/schedule/:meetingId" element={<TimeAvailabilityPage />} />
        <Route path="/book/:username/schedule" element={<TimeAvailabilityPage />} />
        <Route path="/:username/schedule/:meetingId" element={<TimeAvailabilityPage />} />
        <Route path="/:username/schedule" element={<TimeAvailabilityPage />} />
        <Route path="/schedule/:meetingId" element={<TimeAvailabilityPage />} />
        <Route path="/schedule" element={<TimeAvailabilityPage />} />
        <Route path="/book/:username/payment" element={<PaymentCheckoutPage />} />
        <Route path="/:username/payment" element={<PaymentCheckoutPage />} />
        <Route path="/book/payment" element={<PaymentCheckoutPage />} />
        <Route path="/booking/confirmation/:bookingId" element={<BookingConfirmationPage />} />
        <Route path="/booking/status/:token" element={<BookingStatusPage />} />
        <Route path="/booking/cancel/:token" element={<CancelBookingPage />} />
        <Route path="/booking/reschedule/:token" element={<RescheduleBookingPage />} />
        <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
        <Route path="/privacy" element={<Navigate to="/privacy-policy" replace />} />
        <Route path="/terms" element={<TermsPage />} />

        {/* Dedicated Auth routes */}
        <Route path="/login" element={<Navigate to="/admin/login" replace />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        {/* Google OAuth return target. Must sit above the /:username catch-all. */}
        <Route path="/auth/callback" element={<GoogleCallbackPage />} />
        <Route path="/super-admin/login" element={<Navigate to="/admin/login" replace />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/admin/signup" element={<SignupPage />} />

        {/* Super Admin console */}
        <Route path="/super-admin" element={<SuperAdminDashboardPage />} />
        <Route path="/super-admin/settings" element={<SuperAdminSettingsPage />} />

        {/* Individual Admin Portal */}
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<DashboardPage />} />
          <Route path="/admin/setup" element={<SetupPage />} />
          <Route path="/admin/bookings" element={<BookingsPage />} />
          <Route path="/admin/calendar" element={<CalendarPage />} />
          {/* Meeting Types and Availability live inside Settings. The old paths redirect so
              bookmarks and existing links keep working, carrying their query string along. */}
          <Route path="/admin/meeting-types" element={<RedirectWithSearch to="/admin/settings/meeting-types" />} />
          <Route path="/admin/availability" element={<RedirectWithSearch to="/admin/settings/availability" />} />
          <Route path="/admin/customers" element={<CustomersPage />} />
          <Route path="/admin/payments" element={<PaymentsPage />} />
          <Route path="/admin/settings" element={<SettingsPage />} />
          <Route path="/admin/settings/:section" element={<SettingsPage />} />
        </Route>

        {/* Student portal. Must sit above the /:username catch-all. */}
        <Route path="/student/change-password" element={<StudentChangePasswordPage />} />
        <Route element={<StudentLayout />}>
          <Route path="/student" element={<StudentOverviewPage />} />
          <Route path="/student/book" element={<StudentBookPage />} />
          <Route path="/student/meetings" element={<StudentMeetingsPage />} />
          <Route path="/student/recordings" element={<StudentRecordingsPage />} />
        </Route>

        {/* Dynamic Personal Admin Root URL: yourdomain.com/:username & yourdomain.com/bookings/:username */}
        <Route path="/bookings/:username" element={<SuperProfileHomePage />} />
        <Route path="/:username" element={<SuperProfileHomePage />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
};
