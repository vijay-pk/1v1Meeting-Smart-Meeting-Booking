import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle, EyeIcon, Share2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorNote } from '@/components/common/ErrorNote';
import { Skeleton } from '@/components/common/Skeleton';
import { PublicLinkRow, usePublicLinkShare } from '@/components/admin/PublicLink';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { ONBOARDING_STEPS, isStepDone, setupLink } from '@/lib/onboarding';

/**
 * First-time setup. A new admin lands here instead of the dashboard.
 *
 * Each step is completed on the page that already owns it (Settings, Availability, Meeting
 * Types) -- this screen does not duplicate those forms. It shows what the server says is
 * done, sends the admin to the first thing that is not, and hands over to the dashboard once
 * the server has recorded setup as complete.
 */
export function SetupPage() {
  const navigate = useNavigate();
  const { status, error, loading, refresh } = useOnboardingStatus();
  const { url: publicUrl, state: shareState, share, inputRef } = usePublicLinkShare(status?.username);

  // Setup is recorded by the server the first time all four steps are done. The super admin
  // is never held here.
  const alreadyDone = !!status && (status.setup_completed || status.role !== 'admin');

  const nextStep = ONBOARDING_STEPS.find((step) => !isStepDone(status, step.key));
  const completed = status?.completed_count ?? 0;
  const total = status?.total_count ?? ONBOARDING_STEPS.length;

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <PageHeader
        title="Set up your booking page"
        description="Four steps and clients can book and pay you directly. Anything you've already saved is kept."
      />

      {error && !status && <ErrorNote message={error} onRetry={() => void refresh()} />}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Your progress</CardTitle>
            {status && (
              <span className="text-sm font-semibold text-text-secondary">
                {completed} of {total} complete
              </span>
            )}
          </div>
          <div
            className="mt-2 h-2 w-full rounded-full bg-surface-tertiary"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={completed}
          >
            <div
              className="h-2 rounded-full bg-primary-600 transition-all"
              style={{ width: `${total ? (completed / total) * 100 : 0}%` }}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading && !status ? (
            <div className="space-y-3" role="status" aria-label="Loading setup status">
              {ONBOARDING_STEPS.map((step) => (
                <Skeleton key={step.key} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : (
            <ol className="space-y-3">
              {ONBOARDING_STEPS.map((step, index) => {
                const done = isStepDone(status, step.key);
                const isNext = nextStep?.key === step.key;
                return (
                  <li
                    key={step.key}
                    className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
                      isNext ? 'border-primary-300 bg-primary-50/40' : 'border-border'
                    }`}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      {done ? (
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <Circle className="mt-0.5 h-5 w-5 shrink-0 text-text-tertiary" aria-hidden="true" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-primary">
                          Step {index + 1}: {step.label}
                          <span className="sr-only">{done ? ' — done' : ' — not done'}</span>
                        </p>
                        <p className="text-xs text-text-secondary">{step.description}</p>
                      </div>
                    </div>
                    {done ? (
                      <Link
                        to={setupLink(step)}
                        className="shrink-0 text-xs font-semibold text-emerald-700 hover:underline"
                      >
                        Done · Edit
                      </Link>
                    ) : (
                      <Link to={setupLink(step)} className="shrink-0">
                        <Button size="sm" variant={isNext ? 'default' : 'outline'} tabIndex={-1}>
                          {isNext ? 'Continue' : 'Set up'}
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {status && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your booking link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <PublicLinkRow url={publicUrl} state={shareState} inputRef={inputRef} loading={false} />
            {publicUrl && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void share()}>
                  <Share2 className="h-4 w-4" />
                  Share Link
                </Button>
                <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                  <Button type="button" size="sm" variant="outline" tabIndex={-1}>
                    <EyeIcon className="h-4 w-4" />
                    Preview
                  </Button>
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {status && (
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          <p className="text-xs text-text-secondary sm:mr-auto" role="status">
            {alreadyDone
              ? completed === total
                ? 'Setup complete. Your booking page is ready for clients.'
                : 'Setup was completed earlier. Outstanding steps also appear on your dashboard.'
              : 'Finish all four steps to open your dashboard.'}
          </p>
          <Button
            type="button"
            disabled={!alreadyDone}
            onClick={() => navigate('/admin', { replace: true })}
          >
            {alreadyDone ? 'Go to dashboard' : `${total - completed} step${total - completed === 1 ? '' : 's'} left`}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
