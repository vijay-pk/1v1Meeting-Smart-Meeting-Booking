import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { APP_NAME } from '@/lib/constants';
import { LegalFooter } from '@/components/layout/LegalFooter';

/**
 * Public Privacy Policy, served at /privacy-policy (no sign-in).
 *
 * Every statement here is checked against the code (see the commit that introduced this page).
 * To change the policy edit the constants and SECTIONS below; nothing else in the app reads them.
 * Items in <Todo> are details only the operator can supply and must be filled in before the page
 * is relied on.
 */

const LAST_UPDATED = '28 October 2026';
const SITE = 'https://meet.adwaysacademy.com';
// Present in the backend configuration as the Reply-To address of every booking email.
const CONTACT_EMAIL = 'creatives.adways@gmail.com';

const Todo: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <mark className="rounded bg-amber-100 px-1 font-medium text-amber-900">[{children}]</mark>
);

const A: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a href={href} target="_blank" rel="noreferrer" className="text-primary-600 underline underline-offset-2 hover:text-primary-700">
    {children}
  </a>
);

const UL: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ul className="list-disc space-y-1.5 pl-5 marker:text-text-tertiary">{children}</ul>
);

interface Section {
  id: string;
  title: string;
  body: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'introduction',
    title: '1. Introduction and scope',
    body: (
      <>
        <p>
          This Privacy Policy explains how {APP_NAME} ("{APP_NAME}", "we", "us") handles personal information when you visit{' '}
          {SITE}, book a session with a host, pay for a session, or sign in as a host (Admin), student or platform
          administrator (Super Admin).
        </p>
        <p>
          {APP_NAME} is a booking platform. Each host has a public booking page, sets their own session types and
          availability, and connects their own Razorpay and Google accounts. This policy covers the platform as a whole; a
          host may also handle your information for their own purposes (for example, to deliver the session you booked),
          and that is between you and the host.
        </p>
        <p>
          It describes how the platform works today. It is not legal advice and has not been certified as meeting any
          particular law; it is a description of our practices, not a promise of a specific legal outcome.
        </p>
      </>
    ),
  },
  {
    id: 'operator',
    title: '2. Who operates BookMyMeet',
    body: (
      <>
        <p>
          {APP_NAME} is operated under the Adways Academy name at {SITE}. Legal entity:{' '}
          <Todo>OPERATOR LEGAL NAME AND TYPE - to be supplied by the owner</Todo>. Registered address:{' '}
          <Todo>REGISTERED ADDRESS - to be supplied by the owner</Todo>.
        </p>
        <p>
          Privacy contact and grievance contact: <Todo>NAME / DESIGNATION OF PERSON RESPONSIBLE - to be supplied by the owner</Todo>,
          reachable at <a className="text-primary-600 underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </>
    ),
  },
  {
    id: 'information-collected',
    title: '3. Information we collect',
    body: (
      <>
        <p>Depending on how you use the platform, we hold the following. We do not collect a category below unless you use the feature it belongs to.</p>
        <h3 className="mt-4 font-semibold text-text-primary">If you book a session (client)</h3>
        <UL>
          <li>Name and email address; phone number and notes if you provide them.</li>
          <li>The session booked, its date, time, duration and time zone, and its status (confirmed, cancelled, rescheduled).</li>
          <li>The Google Calendar event and Google Meet link created for the session.</li>
          <li>For paid sessions: the payment status, amount, currency and Razorpay order and payment reference numbers (see section 8).</li>
          <li>Private links that let you view, cancel or reschedule that booking.</li>
        </UL>
        <h3 className="mt-4 font-semibold text-text-primary">If you are a host (Admin) or the Super Admin</h3>
        <UL>
          <li>Name, email address, optional phone number, username (your public page address) and a password stored only as a salted hash.</li>
          <li>Public profile content you enter: title, biography, photo, cover image, video link, theme and welcome text.</li>
          <li>Session types, prices, working hours and days off.</li>
          <li>Connection details for your own Google account (Google email address, calendar identifier and access and refresh tokens) and your own Razorpay account (public key identifier and an encrypted secret key).</li>
          <li>Notifications generated for you, such as new bookings and reminders.</li>
        </UL>
        <h3 className="mt-4 font-semibold text-text-primary">If you are a student</h3>
        <UL>
          <li>Name, email address and a password (stored as a hash). Your account is created by the Super Admin.</li>
          <li>Your free-meeting allowance, any adjustments to it (with the reason and who made it), your acceptance of the student meeting rules, and your meeting history including attendance outcome.</li>
          <li>Records that a credentials email or report was sent to you.</li>
          <li>Recording information, only where recording is enabled (see section 10).</li>
        </UL>
        <h3 className="mt-4 font-semibold text-text-primary">Technical information</h3>
        <UL>
          <li>Sign-in session data: a signed sign-in token and basic account details kept in your browser (section 6).</li>
          <li>Security data: when your password was last changed, so older sign-in tokens can be revoked.</li>
          <li>The application does not deliberately record IP addresses or browser details in its database and has no advertising or analytics tracking. Hosting providers (section 11) may process IP addresses and request details in routine server logs. Operational logs of the application mainly contain internal identifiers, and may include error messages returned by Google or Razorpay.</li>
        </UL>
      </>
    ),
  },
  {
    id: 'how-collected',
    title: '4. How we collect information',
    body: (
      <UL>
        <li>Directly from you: forms for booking, sign-up, profile and settings.</li>
        <li>From the Super Admin, who creates student accounts and manages allowances.</li>
        <li>From Google when a host connects their account or signs in with Google (name, verified email address, calendar and Meet details).</li>
        <li>From Razorpay, which tells us whether a payment succeeded.</li>
        <li>Automatically, as part of running the service (for example, booking status changes, reminders and meeting end processing).</li>
      </UL>
    ),
  },
  {
    id: 'purposes',
    title: '5. Why we use information, and our basis',
    body: (
      <>
        <p>We use personal information to:</p>
        <UL>
          <li>provide the service: create and manage accounts, show host pages, offer available times, take bookings and prevent two people booking the same slot;</li>
          <li>create calendar events and Meet links, and end meetings at their scheduled end (plus a short grace period);</li>
          <li>process and verify payments and keep a transaction record;</li>
          <li>administer student allowances, attendance and history;</li>
          <li>send confirmations, reminders, rescheduling and cancellation notices, and account emails;</li>
          <li>keep the platform secure, investigate misuse and resolve complaints and disputes;</li>
          <li>meet legal, accounting and regulatory obligations.</li>
        </UL>
        <p>
          Where the Digital Personal Data Protection Act, 2023 applies, we rely on your consent (for example, when you submit
          a booking or accept the student rules) and on the legitimate uses the Act permits, such as performing a service you
          requested and complying with the law. We have not determined that every provision of that Act applies to us and we
          do not claim certification or compliance with any law.
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: '6. Cookies, sessions and similar technologies',
    body: (
      <>
        <p>
          {APP_NAME} does not set advertising or analytics cookies. To keep you signed in, your browser stores a sign-in token
          and basic account details (such as your role, username and name) in browser storage (sessionStorage and
          localStorage). It also stores your colour-theme preference and, while you complete a booking, a temporary
          checkout identifier. This is needed for the service to work; clearing your browser data signs you out.
        </p>
        <p>
          Some pages load content from third parties, which may set their own cookies or receive your IP address and device
          details: Google Fonts (page text styling), YouTube (privacy-enhanced embed) and Vimeo (a host's intro video, only
          if they use one) and Razorpay's checkout window when you pay. See their policies.
        </p>
      </>
    ),
  },
  {
    id: 'bookings',
    title: '7. Bookings, scheduling and notifications',
    body: (
      <>
        <p>
          When you book, we hold the time while you check out, then confirm the booking, create a Google Calendar event with a
          Meet link on the host's calendar and email you. Cancelling or rescheduling updates the booking and the calendar
          event. Hosts and the Super Admin can see the bookings made with them, including your name, email, phone and notes.
        </p>
        <p>
          Emails are sent through Resend: booking confirmations, new-booking alerts to the host, reschedule and cancellation
          notices, meeting reminders to the host, an end-of-session notice shortly after the booked time, student credential and
          report emails, and recording-ready notices where recording is enabled. Hosts also see in-app notifications.
        </p>
        <p>
          Every meeting is ended automatically three minutes after its scheduled end, even if people are still talking.
        </p>
      </>
    ),
  },
  {
    id: 'payments',
    title: '8. Payments',
    body: (
      <>
        <p>
          Paid sessions are paid through Razorpay, using the host's own Razorpay account, so the payment is received by the
          host and not by {APP_NAME}. You enter card, UPI or bank details in Razorpay's checkout window, which is loaded from
          Razorpay. In the application's code we do not receive, process or store card numbers, CVV or bank credentials.
        </p>
        <p>
          We receive from Razorpay, and keep, the order and payment reference numbers, amount, currency and a status
          (created, captured or failed). We also pass your name, email and phone number to Razorpay's checkout window to
          pre-fill it. We verify each payment with a cryptographic signature before confirming a booking. Razorpay handles your
          payment data under its own privacy policy: <A href="https://razorpay.com/privacy/">razorpay.com/privacy</A>.
        </p>
      </>
    ),
  },
  {
    id: 'google',
    title: '9. Google Calendar and Google Meet',
    body: (
      <>
        <p>
          A host (and the Super Admin) may connect their own Google account. We request these permissions:
        </p>
        <UL>
          <li>view and edit events on their calendars, to create a booking's event and move it when rescheduled;</li>
          <li>view their calendars, to check when they are busy so we do not offer a time they cannot take;</li>
          <li>their email address, to show which account is connected;</li>
          <li>create and manage Google Meet meeting spaces created by {APP_NAME}, to create a Meet link per booking and end the meeting at its scheduled end.</li>
        </UL>
        <p>
          We store the connected account's email address, calendar identifier and access and refresh tokens (the refresh
          token is encrypted). Event details sent to Google include the session title, the client's name and email address and
          the booking notes. We use Google information only to provide these features. Google processes data under its own
          policies: <A href="https://policies.google.com/privacy">policies.google.com/privacy</A>.
        </p>
        <p>
          Hosts can disconnect Google in {APP_NAME} settings, which revokes the connection, and can also remove access at any
          time at <A href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</A>. Without a connection,
          that host's bookings cannot create Meet links or check calendar availability.
        </p>
        <p>
          Clients and students do not give {APP_NAME} access to their Google accounts. Signing in with Google (as a host) uses
          Supabase to verify your name and verified email address.
        </p>
      </>
    ),
  },
  {
    id: 'recordings',
    title: '10. Recordings',
    body: (
      <>
        <p>
          {APP_NAME} does not record meetings by itself and does not automatically record every meeting. A recording exists only
          if the Super Admin's Google account records the meeting. A feature to find such recordings and show them to the
          student concerned exists in the platform but is switched off unless the operator enables it. Where it is off, no
          recording information is collected or shown.
        </p>
        <p>
          Where it is enabled: we keep only a reference (the meeting space, Google Drive file identifier, title, date and
          status), not the video. The video remains in the Super Admin's Google Drive and is streamed to the student through the
          platform using short-lived, signed links. A recording is visible only to the student who attended that session and to
          the Super Admin; hosts do not have access. The student receives an email when a recording becomes available.
          Recordings are subject to Google's policies and to any consent notices shown in the meeting.
        </p>
      </>
    ),
  },
  {
    id: 'sharing',
    title: '11. Sharing and service providers',
    body: (
      <>
        <p>We do not sell personal information. We share it only as needed to run the service:</p>
        <UL>
          <li><strong>The host</strong> you book with, and the Super Admin, who administers the platform and handles support.</li>
          <li><strong>Razorpay</strong> - payment processing (section 8).</li>
          <li><strong>Google</strong> - Calendar, Meet and (for hosts) sign-in (section 9).</li>
          <li><strong>Resend</strong> - sends our emails; it receives the recipient's address and the message content.</li>
          <li><strong>Supabase</strong> - hosted PostgreSQL database (in the ap-south-1 region at the time of writing), sign-in verification for Google accounts, and public file storage for uploaded profile photos. Uploaded profile images are publicly viewable by anyone with the link.</li>
          <li><strong>Render</strong> (backend application hosting) and <strong>Vercel</strong> (website hosting). Our deployment notes also describe a planned move of the backend to a server in Mumbai; this policy will be updated if that happens.</li>
          <li>Authorities or advisers, where the law requires it or to protect rights and safety.</li>
        </UL>
        <p>Each provider handles information under its own terms. We do not give providers access to our credentials.</p>
      </>
    ),
  },
  {
    id: 'retention',
    title: '12. Retention and deletion',
    body: (
      <>
        <p>
          We keep information for as long as needed to provide the service and for legitimate operational, financial,
          security, dispute-resolution and legal purposes. We have not set fixed retention periods and the platform does not
          currently delete records automatically after a set time.
        </p>
        <p>What happens today when an account is deleted by the Super Admin:</p>
        <UL>
          <li>
            <strong>Host:</strong> the account, profile, session types, availability, notifications, reminders, uploaded
            images, and the stored Google and Razorpay connections (including their encrypted secrets) are deleted. Bookings
            are kept but anonymised: client name, email, phone, notes, Meet link and event reference are removed and active
            bookings are cancelled. Payment records are kept as a financial record without a link to the deleted host. The
            host's email address is retained only as a one-way keyed fingerprint, and the username is retired, so the same
            email cannot register again.
          </li>
          <li>
            <strong>Student:</strong> the account, allowance and adjustment history, rule acceptance, credential and report
            records, and recording references are deleted. Their bookings are kept but anonymised and upcoming ones are
            cancelled. Payment records are kept.
          </li>
        </UL>
        <p>
          Deletion does not instantly remove everything: database backups, logs and copies held by Google, Razorpay, Resend and
          our hosting providers may persist under their own policies, and Google Calendar events or Drive files remain in the
          account that owns them until removed there. Deleted data cannot be recovered by us once removed from the live system.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    title: '13. Security',
    body: (
      <>
        <p>We use measures including:</p>
        <UL>
          <li>passwords stored only as salted hashes, never in readable form;</li>
          <li>Google refresh tokens and Razorpay secret keys stored encrypted;</li>
          <li>signed sign-in tokens that expire after seven days and are revoked when a password changes;</li>
          <li>account status and role re-checked on every request on our servers;</li>
          <li>payment signature verification, and each host's payments going to their own Razorpay account;</li>
          <li>encrypted connections (HTTPS) provided by our hosting providers.</li>
        </UL>
        <p>
          No system is perfectly secure. Some data, such as the Google access token held for a connected account, is kept
          for the service to work and is protected by access controls rather than encryption. Please keep your password
          private and tell us at once if you suspect misuse. If a personal data breach affects you we will act as the law
          requires.
        </p>
      </>
    ),
  },
  {
    id: 'transfers',
    title: '14. Where information is processed',
    body: (
      <p>
        Our providers operate in several countries. The database is hosted by Supabase in the ap-south-1 (Mumbai) region
        at the time of writing, but the application server is hosted by Render in the United States, and Google, Razorpay,
        Resend and Vercel may process data in other locations. Your information may therefore be processed outside India.
        We do not state that data is held in any single country.
      </p>
    ),
  },
  {
    id: 'rights',
    title: '15. Your rights and how to make a request',
    body: (
      <>
        <p>
          Subject to applicable law you may ask us to: tell you what we hold about you, correct inaccurate information, delete
          it, restrict how it is used, or withdraw consent you gave. You can also nominate someone to exercise these rights on
          your behalf where the law allows.
        </p>
        <p>
          The platform does not yet have a self-service deletion or export tool. To make a request, email{' '}
          <a className="text-primary-600 underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the
          email address on the account or booking, say what you want, and give the booking reference where you have one. We may
          need to verify your identity first. Hosts can edit their own profile and settings directly after signing in.
          Withdrawing consent may mean we can no longer provide some features. We will respond within the time the law
          requires <Todo>response time commitment - owner to confirm</Todo>.
        </p>
      </>
    ),
  },
  {
    id: 'closure',
    title: '16. Account closure, correction and deletion',
    body: (
      <p>
        Hosts and students cannot delete their own accounts in the application today. Ask us to close or delete an account (see
        section 15) and the Super Admin will carry it out as described in section 12. Students can cancel or reschedule
        bookings until 24 hours before the session. We may keep information we are required or entitled to keep, for example
        payment records, and records needed to resolve a dispute or prevent misuse.
      </p>
    ),
  },
  {
    id: 'children',
    title: "17. Children's and students' privacy",
    body: (
      <>
        <p>
          {APP_NAME} is intended for adults. Students are enrolled by the Super Admin. We do not knowingly collect information
          from anyone under 18 without the consent of a parent or lawful guardian where the law requires it. If you believe a
          child's information has been provided without that consent, contact us and we will take appropriate steps.
        </p>
        <p>
          Student information (allowance, history, recordings) is visible to that student and the Super Admin, not to hosts
          or other students.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: '18. Changes to this policy',
    body: (
      <p>
        We may update this policy as the platform changes. The "Last updated" date at the top shows the current version.
        Where a change is significant we will give notice in a suitable way.
      </p>
    ),
  },
  {
    id: 'contact',
    title: '19. Contact and complaints',
    body: (
      <>
        <p>
          Questions, requests and complaints about privacy: <a className="text-primary-600 underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          {' '}(<Todo>grievance officer name and postal address - owner to supply</Todo>). If we do not resolve your complaint you may
          have the right to approach the Data Protection Board of India or another authority, where the law provides.
        </p>
      </>
    ),
  },
];

export const PrivacyPolicyPage: React.FC = () => {
  return (
    <div className="flex min-h-screen flex-col bg-surface-secondary text-text-primary">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-text-primary">
            <img src="/logo.png" alt="" className="h-7 w-7 rounded" />
            {APP_NAME}
          </Link>
          <Link to="/" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700">
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
            <ShieldCheck className="h-4 w-4" />
            Privacy
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="mt-1 text-sm text-text-tertiary">Last updated: {LAST_UPDATED}</p>

          <nav aria-label="Table of contents" className="mt-6 rounded-xl border border-border bg-surface-secondary p-4">
            <h2 className="text-sm font-semibold">Contents</h2>
            <ol className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="inline-block py-1 text-text-secondary hover:text-primary-600">
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-text-secondary">
            {SECTIONS.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-6 space-y-3">
                <h2 className="text-xl font-semibold text-text-primary">{s.title}</h2>
                {s.body}
              </section>
            ))}
          </div>
        </div>
      </main>

      <LegalFooter />
    </div>
  );
};
