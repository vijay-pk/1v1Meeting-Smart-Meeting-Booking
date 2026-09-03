import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Neutral placeholder shown when an admin has not set a profile photo. */
export const DEFAULT_AVATAR = '/assets/default-avatar.png';
