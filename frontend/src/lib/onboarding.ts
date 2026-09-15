import type { OnboardingStatus } from './api';

export type OnboardingStepKey = 'profile' | 'working_hours' | 'meeting_type' | 'gateway';

export interface OnboardingStep {
  key: OnboardingStepKey;
  label: string;
  description: string;
  /** Where the step is done. */
  link: string;
}

/**
 * The four setup steps, in order. Labels and destinations only -- whether a step is done
 * comes from GET /api/profiles/me/onboarding and is never decided here.
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    key: 'profile',
    label: 'Profile & Photo',
    description: 'Your name, booking link username and a profile photo clients will see.',
    link: '/admin/settings',
  },
  {
    key: 'working_hours',
    label: 'Working Hours',
    description: 'The weekly hours clients can book. Start from the default and adjust.',
    link: '/admin/availability',
  },
  {
    key: 'meeting_type',
    label: 'Active Meeting Type',
    description: 'At least one active session with its duration and your price.',
    link: '/admin/meeting-types',
  },
  {
    key: 'gateway',
    label: 'Connect Gateway',
    description: 'Your own Razorpay account, so payments settle directly to you.',
    link: '/admin/settings?tab=payment',
  },
];

export function isStepDone(status: OnboardingStatus | null, key: OnboardingStepKey): boolean {
  return !!status && status[key] === true;
}

/** The step's page, marked so the admin shell offers a way back to setup from it. */
export function setupLink(step: OnboardingStep): string {
  return `${step.link}${step.link.includes('?') ? '&' : '?'}from=setup`;
}
