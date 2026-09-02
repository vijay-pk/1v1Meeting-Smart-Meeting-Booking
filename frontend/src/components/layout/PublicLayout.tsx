import { Outlet } from 'react-router-dom';
import { APP_NAME } from '@/lib/constants';

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-surface-secondary">
      {/* Minimal header for public pages */}
      <header className="bg-white border-b border-border">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary-600 text-white font-bold text-xs">
              B
            </div>
            <span className="font-semibold text-text-primary">{APP_NAME}</span>
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
      <footer className="border-t border-border bg-white py-8 mt-12">
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
