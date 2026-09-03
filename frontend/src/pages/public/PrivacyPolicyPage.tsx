import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowLeft } from 'lucide-react';

export const PrivacyPolicyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 py-12 px-4 sm:px-6 font-sans">
      <div className="max-w-3xl mx-auto space-y-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Home</span>
        </Link>

        <div className="space-y-2 border-b border-slate-800 pb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Privacy & Data Protection</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white">Privacy Policy</h1>
          <p className="text-xs text-slate-400">Last updated: September 2026</p>
        </div>

        <div className="space-y-6 text-sm text-slate-300 leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">1. Information We Collect</h2>
            <p>
              BookMyMeet collects essential information necessary to facilitate 1:1 appointment bookings and video conferencing:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-400">
              <li>Consultant profile information: Name, email address, username, profile photo, and bio.</li>
              <li>Attendee information: Name, email address, phone number (optional), and meeting notes.</li>
              <li>Payment details: Razorpay transaction reference identifiers. We do not store raw card numbers or CVVs.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">2. Google Calendar & Google Meet Data</h2>
            <p>
              When you connect your Google account, we access your Google Calendar via official Google OAuth APIs strictly for:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-400">
              <li>Detecting busy time slots to prevent double-booking.</li>
              <li>Creating calendar events for confirmed bookings.</li>
              <li>Generating secure Google Meet video conference links for your sessions.</li>
            </ul>
            <p>
              We do not sell, share, or use Google user data for advertising or any purpose unrelated to scheduling your appointments.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">3. Data Security</h2>
            <p>
              All data transmitted between your browser and our servers is encrypted using 256-bit SSL/TLS encryption. API credentials are encrypted at rest using industry-standard AES-256 encryption.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-white">4. Contact Us</h2>
            <p>
              If you have any questions regarding this Privacy Policy or your personal data, you can reach out via your consultant booking portal or platform administrator.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
