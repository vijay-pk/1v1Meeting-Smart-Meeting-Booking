import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

// Layouts
import { AdminLayout } from '@/components/layout/AdminLayout';
import { PublicLayout } from '@/components/layout/PublicLayout';

// Admin Pages
import { DashboardPage } from '@/pages/admin/DashboardPage';
import { BookingsPage } from '@/pages/admin/BookingsPage';
import { PaymentsPage } from '@/pages/admin/PaymentsPage';
import { CustomersPage } from '@/pages/admin/CustomersPage';
import { SettingsPage } from '@/pages/admin/SettingsPage';
import { SetupPage } from '@/pages/admin/SetupPage';
import { CalendarPage } from '@/pages/admin/CalendarPage';

// Super Admin Pages
import { SuperAdminDashboardPage } from '@/pages/super-admin/SuperAdminDashboardPage';
import { SuperAdminSettingsPage } from '@/pages/super-admin/SuperAdminSettingsPage';
import { SuperAdminLoginPage } from '@/pages/auth/SuperAdminLoginPage';
import { AdminLoginPage } from '@/pages/auth/AdminLoginPage';

// Auth Pages
import { LoginPage } from '@/pages/auth/LoginPage';
import { SignupPage } from '@/pages/auth/SignupPage';
import { GoogleCallbackPage } from '@/pages/auth/GoogleCallbackPage';

// Public Pages
import { SuperProfileHomePage } from '@/pages/public/SuperProfileHomePage';
import { TimeAvailabilityPage } from '@/pages/public/TimeAvailabilityPage';
import { PaymentCheckoutPage } from '@/pages/public/PaymentCheckoutPage';
import { BookingConfirmationPage } from '@/pages/public/BookingConfirmationPage';
import { BookingStatusPage } from '@/pages/public/BookingStatusPage';
import { PrivacyPolicyPage } from '@/pages/public/PrivacyPolicyPage';
import { TermsPage } from '@/pages/public/TermsPage';
import { CancelBookingPage } from '@/pages/public/CancelBookingPage';
import { RescheduleBookingPage } from '@/pages/public/RescheduleBookingPage';

import { warmUpBackend } from '@/lib/api';

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
      <Routes>
        {/* Main Interface: Admin Signup Platform */}
        <Route path="/" element={<SignupPage />} />
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
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
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

        {/* Dynamic Personal Admin Root URL: yourdomain.com/:username & yourdomain.com/bookings/:username */}
        <Route path="/bookings/:username" element={<SuperProfileHomePage />} />
        <Route path="/:username" element={<SuperProfileHomePage />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
