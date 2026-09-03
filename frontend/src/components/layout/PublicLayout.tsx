import { Outlet } from 'react-router-dom';
import { APP_NAME } from '@/lib/constants';

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-surface-secondary">
      {/* Minimal header for public pages */}
      <header className="bg-surface border-b border-border">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <img
              src="/logo.png"
              alt="BookMyMeet Logo"
              className="w-8 h-8 object-contain rounded-lg shrink-0 shadow-xs"
            />
            <span className="font-bold text-text-primary">{APP_NAME}</span>
          </a>
          <div className="flex items-center gap-4">
            <a
              href="/login"
              className="text-sm text-text-secondary hover:text-primary-600 transition-colors"
            >
              Sign in
            </a>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main>
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-surface py-8 mt-12">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <p className="text-sm text-text-tertiary">
            Powered by{' '}
            <span className="font-medium text-text-secondary">{APP_NAME}</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
