import React from 'react';
import { Link } from 'react-router-dom';
import { APP_NAME } from '@/lib/constants';

/** Shared public footer: copyright plus legal links. Used by the sign-in shell, the public
 *  booking pages and the policy pages themselves. */
export const LegalFooter: React.FC<{ className?: string }> = ({ className = '' }) => (
  <footer className={`safe-b mx-auto w-full max-w-6xl px-4 py-6 text-center text-xs text-text-tertiary sm:px-6 ${className}`}>
    <nav aria-label="Legal" className="mb-1 flex flex-wrap items-center justify-center gap-x-4">
      <Link to="/privacy-policy" className="inline-flex min-h-11 items-center underline-offset-2 hover:text-primary-600 hover:underline">
        Privacy Policy
      </Link>
      <Link to="/terms" className="inline-flex min-h-11 items-center underline-offset-2 hover:text-primary-600 hover:underline">
        Terms
      </Link>
    </nav>
    <p>
      © {new Date().getFullYear()} {APP_NAME}
    </p>
  </footer>
);
