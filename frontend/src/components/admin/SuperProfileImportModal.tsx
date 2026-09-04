import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { AlertCircle, CheckCircle, Download, Loader2, ExternalLink } from 'lucide-react';

/**
 * Import from SuperProfile.
 *
 * Nothing here writes to the admin's profile. The backend parses the public page into a
 * pending import, this screen shows exactly what was found, and only "Import Selected Data"
 * applies the parts the admin ticked. Fields the page does not expose stay empty rather than
 * being filled with plausible-looking defaults.
 */

type Phase = 'url' | 'loading' | 'preview' | 'applying' | 'done';
type ImportMode = 'add' | 'replace' | 'sessions_only' | 'profile_only';
type SessionAction = 'create' | 'update' | 'skip';

interface ParsedSession {
  title: string;
  description: string | null;
  duration_minutes: number | null;
  price: number | null;
  original_price: number | null;
  currency: string | null;
  category: string | null;
  /** Only ever a YouTube or Vimeo link, and only shown -- sessions store no video. */
  video_url: string | null;
  short_description: string | null;
  input_fields: Array<{ label: string; type: string | null; required: boolean; description: string | null }>;
  source_ref: string | null;
  badge: string | null;
}

interface ParsedProfile {
  name: string | null;
  headline: string | null;
  bio: string | null;
  // No photo fields, deliberately: the backend never parses a SuperProfile image, so there
  // is nothing here to render or send back, and an import cannot touch the admin's photo.
  video_url: string | null;
  video_provider: 'youtube' | 'vimeo' | null;
  video_embed_url: string | null;
  video_source: 'profile' | 'session' | null;
  social_links: Record<string, string>;
  website: string | null;
  public_links: Array<{ label: string; url: string }>;
  faqs: Array<{ question: string; answer: string }>;
}

interface Duplicate {
  session_index: number;
  existing_session_id: string | null;
  existing_title: string;
  reason?: 'source_ref' | 'title' | 'title_and_duration';
}

interface SessionDraft extends ParsedSession {
  selected: boolean;
  action: SessionAction;
  target_session_id: string | null;
}

const PROFILE_FIELDS: Array<{ key: string; label: string; get: (p: ParsedProfile) => string | null }> = [
  { key: 'name', label: 'Display name', get: (p) => p.name },
  { key: 'headline', label: 'Headline / tagline', get: (p) => p.headline },
  { key: 'bio', label: 'Bio', get: (p) => p.bio },
  { key: 'intro_video', label: 'Intro video', get: (p) => p.video_url },
  { key: 'website', label: 'Website', get: (p) => p.website },
];

const MODE_LABELS: Record<ImportMode, string> = {
  add: 'Add imported content (does not overwrite what you already have)',
  replace: 'Replace selected fields with the imported values',
  sessions_only: 'Import sessions only',
  profile_only: 'Import profile only',
};

/** Mirrors the server's rule, so obvious mistakes never leave the browser. */
function validateUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Paste your public SuperProfile URL.';
  let parsed: URL;
  try {
    parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return 'Invalid SuperProfile URL.';
  }
  if (parsed.protocol !== 'https:') return 'Only https:// SuperProfile links can be imported.';
  if (!['superprofile.bio', 'www.superprofile.bio'].includes(parsed.hostname.toLowerCase())) {
    return 'Invalid SuperProfile URL. It should look like https://superprofile.bio/bookings/your-handle';
  }
  return null;
}

export const SuperProfileImportModal: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}> = ({ open, onOpenChange, onImported }) => {
  const [phase, setPhase] = useState<Phase>('url');
  const [sourceUrl, setSourceUrl] = useState('');
  const [error, setError] = useState('');
  const [importId, setImportId] = useState('');
  const [profile, setProfile] = useState<ParsedProfile | null>(null);
  const [sessions, setSessions] = useState<SessionDraft[]>([]);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedProfileFields, setSelectedProfileFields] = useState<Record<string, boolean>>({});
  const [importSocials, setImportSocials] = useState(true);
  const [mode, setMode] = useState<ImportMode>('add');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [result, setResult] = useState<any>(null);
  // Set only when the backend reports an anti-bot block. Pasting the page is the fallback,
  // never the front door: SuperProfile refuses non-browser clients, and imitating a browser
  // to get around that is not something this feature does.
  const [blocked, setBlocked] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDesktopSteps, setShowDesktopSteps] = useState(false);
  const [pageHtml, setPageHtml] = useState('');

  const duplicateFor = useMemo(() => {
    const map = new Map<number, Duplicate>();
    duplicates.forEach((d) => map.set(d.session_index, d));
    return map;
  }, [duplicates]);

  const reset = () => {
    setPhase('url');
    setSourceUrl('');
    setError('');
    setImportId('');
    setProfile(null);
    setSessions([]);
    setDuplicates([]);
    setWarnings([]);
    setSelectedProfileFields({});
    setImportSocials(true);
    setMode('add');
    setConfirmReplace(false);
    setResult(null);
    setBlocked(false);
    setShowAdvanced(false);
    setShowDesktopSteps(false);
    setPageHtml('');
  };

  const close = () => {
    if (importId && phase === 'preview') {
      // Mark the pending import as cancelled rather than leaving it open forever.
      api.importCancel(importId).catch(() => {});
    }
    reset();
    onOpenChange(false);
  };

  const handlePreview = async () => {
    const invalid = validateUrl(sourceUrl);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (showAdvanced && !pageHtml.trim()) {
      setError('Paste the page content, or try the URL again.');
      return;
    }
    setError('');
    setPhase('loading');
    try {
      const data = await api.importPreview(sourceUrl.trim(), showAdvanced ? pageHtml : undefined);
      setImportId(data.import_id);
      setProfile(data.profile);
      setDuplicates(data.duplicates || []);
      setWarnings(data.warnings || []);

      const dupIndexes = new Set<number>((data.duplicates || []).map((d: Duplicate) => d.session_index));
      setSessions(
        (data.sessions || []).map((s: ParsedSession, index: number) => ({
          ...s,
          // A session that looks like one you already have starts unticked: the admin
          // decides whether to update, add a second one, or skip.
          selected: !dupIndexes.has(index),
          action: dupIndexes.has(index) ? 'skip' : 'create',
          target_session_id:
            (data.duplicates || []).find((d: Duplicate) => d.session_index === index)?.existing_session_id || null,
        })),
      );

      const preselected: Record<string, boolean> = {};
      PROFILE_FIELDS.forEach((f) => {
        preselected[f.key] = !!f.get(data.profile);
      });
      setSelectedProfileFields(preselected);
      setBlocked(false);
      setPhase('preview');
    } catch (e: any) {
      if (e?.status === 'blocked') {
        // Its own screen, not a red error: nothing is wrong with what the admin typed.
        setBlocked(true);
        setError('');
      } else {
        setError(e?.message || 'Unable to access this public page.');
      }
      setPhase('url');
    }
  };

  const handleApply = async () => {
    if (mode === 'replace' && !confirmReplace) {
      setError('Tick the confirmation to replace your existing profile information.');
      return;
    }
    setError('');
    setPhase('applying');
    try {
      const profileFields = Object.entries(selectedProfileFields)
        .filter(([, on]) => on)
        .map(([key]) => key);
      if (importSocials) profileFields.push('social_links');

      const data = await api.importApply({
        import_id: importId,
        mode,
        profile_fields: profileFields,
        sessions: sessions
          .filter((s) => s.selected || s.action === 'update')
          .map((s, i) => ({
            index: sessions.indexOf(s),
            action: s.selected ? s.action : 'skip',
            target_session_id: s.action === 'update' ? s.target_session_id : null,
            title: s.title,
            description: s.description || '',
            duration_minutes: s.duration_minutes,
            price: s.price,
            currency: s.currency || undefined,
          })),
        confirm_replace: confirmReplace,
      });
      setResult(data);
      setPhase('done');
      onImported?.();
    } catch (e: any) {
      setError(e?.message || 'Some information could not be imported.');
      setPhase('preview');
    }
  };

  const updateSession = (index: number, patch: Partial<SessionDraft>) => {
    setSessions((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const allSelected = sessions.length > 0 && sessions.every((s) => s.selected);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="admin-sheet max-h-[92dvh] w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl p-4 sm:max-w-3xl sm:rounded-3xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-xl font-extrabold text-text-primary flex items-center gap-2">
            <Download className="w-5 h-5 text-indigo-600" />
            Import from SuperProfile
          </DialogTitle>
          <DialogDescription className="text-xs text-text-tertiary">
            Paste your public SuperProfile URL. Nothing is changed until you review what was
            found and choose what to import.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* ---------------------------------------------------------------- URL step */}
        {(phase === 'url' || phase === 'loading') && (
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="sp-url" className="text-xs font-semibold text-text-secondary">
                Your public SuperProfile booking URL
              </Label>
              <Input
                id="sp-url"
                value={sourceUrl}
                onChange={(e) => { setSourceUrl(e.target.value); setBlocked(false); }}
                placeholder="https://superprofile.bio/bookings/your-handle"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                // 16px under `md` so iOS does not zoom the modal on focus.
                className="h-11 text-base sm:text-sm rounded-xl"
                disabled={phase === 'loading'}
                onKeyDown={(e) => e.key === 'Enter' && phase === 'url' && handlePreview()}
              />
              <p className="text-[11px] text-text-tertiary">
                Your sessions live on the <strong>booking</strong> page, so use that one.
              </p>
            </div>

            {/* The one case with a specific remedy gets its own calm screen rather than a
                wall of red text. Nothing the admin typed is wrong. */}
            {blocked && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-amber-900">
                      SuperProfile blocked automated access
                    </p>
                    <p className="text-[11px] text-amber-900/90 leading-relaxed">
                      We can&rsquo;t read this page automatically right now. You can try again,
                      or provide the public page content yourself.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    type="button"
                    onClick={handlePreview}
                    disabled={phase === 'loading'}
                    className="min-h-[44px] flex-1 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold cursor-pointer"
                  >
                    Try URL again
                  </Button>
                  {!showAdvanced && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowAdvanced(true)}
                      className="min-h-[44px] flex-1 rounded-xl text-xs font-bold cursor-pointer"
                    >
                      Advanced: paste page HTML
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Advanced only, and only ever opened deliberately. */}
            {showAdvanced && (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="sp-html" className="text-xs font-semibold text-text-secondary">
                    Advanced: paste page HTML
                  </Label>
                  <button
                    type="button"
                    onClick={() => { setShowAdvanced(false); setPageHtml(''); setError(''); }}
                    className="text-[11px] font-semibold text-indigo-600 hover:underline cursor-pointer min-h-[32px] px-1"
                  >
                    Back to URL
                  </button>
                </div>
                <p className="text-[11px] text-text-tertiary leading-relaxed">
                  Open your SuperProfile booking page in a browser that can show the page
                  content, copy it, and paste it below.
                </p>
                <Textarea
                  id="sp-html"
                  value={pageHtml}
                  onChange={(e) => setPageHtml(e.target.value)}
                  rows={4}
                  placeholder="Paste the page content here"
                  className="text-[11px] rounded-xl font-mono"
                  disabled={phase === 'loading'}
                />
                <button
                  type="button"
                  onClick={() => setShowDesktopSteps((v) => !v)}
                  aria-expanded={showDesktopSteps}
                  className="text-[11px] font-semibold text-text-tertiary hover:text-text-secondary hover:underline cursor-pointer min-h-[32px]"
                >
                  {showDesktopSteps ? 'Hide' : 'Show'} desktop instructions
                </button>
                {showDesktopSteps && (
                  <p className="text-[10px] text-text-tertiary leading-relaxed">
                    On a computer: open the page, right-click &rarr; Inspect, right-click the
                    top <code>&lt;html&gt;</code> element &rarr; Copy &rarr; Copy outerHTML.
                    &ldquo;View source&rdquo; works too, but SuperProfile draws its prices in
                    the browser, so a view-source copy imports sessions without prices.
                  </p>
                )}
              </div>
            )}

            <Button
              onClick={handlePreview}
              disabled={phase === 'loading'}
              className="w-full sm:w-auto min-h-[44px] bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl px-5 cursor-pointer"
            >
              {phase === 'loading' ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the page&hellip;
                </span>
              ) : (
                'Import'
              )}
            </Button>

            <p className="text-[11px] text-text-tertiary leading-relaxed">
              Only import content you have permission to reuse. This reads the public page
              only &mdash; it does not sign in to SuperProfile and does not work around any
              access control. Your booking link, photo, prices, payment settings and calendar
              connection are never changed without your confirmation.
            </p>
          </div>
        )}

        {/* ------------------------------------------------------------ Preview step */}
        {(phase === 'preview' || phase === 'applying') && profile && (
          <div className="space-y-5 pt-1">
            {warnings.length > 0 && (
              <ul className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 space-y-1 list-disc pl-6">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}

            {/* Profile preview */}
            <section className="space-y-3">
              <h3 className="text-sm font-black text-text-primary">Profile preview</h3>

              <div className="flex items-start gap-4 p-4 rounded-2xl border border-border bg-surface-secondary">
                <div className="min-w-0 space-y-1.5 flex-1">
                  {PROFILE_FIELDS.map((field) => {
                    const value = field.get(profile);
                    if (!value) return null;
                    return (
                      <label key={field.key} className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!selectedProfileFields[field.key]}
                          onChange={(e) =>
                            setSelectedProfileFields((prev) => ({ ...prev, [field.key]: e.target.checked }))
                          }
                          className="mt-1 cursor-pointer"
                        />
                        <span className="min-w-0">
                          <span className="block text-[10px] font-bold uppercase tracking-wide text-text-tertiary">
                            {field.label}
                          </span>
                          <span className="block text-xs text-slate-800 break-words">{value}</span>
                        </span>
                      </label>
                    );
                  })}

                  {Object.keys(profile.social_links || {}).length > 0 && (
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={importSocials}
                        onChange={(e) => setImportSocials(e.target.checked)}
                        className="mt-1 cursor-pointer"
                      />
                      <span>
                        <span className="block text-[10px] font-bold uppercase tracking-wide text-text-tertiary">
                          Social links
                        </span>
                        <span className="block text-xs text-slate-800 break-all">
                          {Object.entries(profile.social_links).map(([k, v]) => `${k}: ${v}`).join('  •  ')}
                        </span>
                      </span>
                    </label>
                  )}

                  {!PROFILE_FIELDS.some((f) => f.get(profile)) && (
                    <p className="text-xs text-text-tertiary">
                      No public profile information could be imported from that page.
                    </p>
                  )}
                </div>
              </div>

              {/* Video. Only YouTube/Vimeo reaches this point; anything else was dropped
                  server-side, and there is no photo section at all by design. */}
              {profile.video_url ? (
                <div className="p-3 rounded-xl border border-border space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
                    {profile.video_provider === 'vimeo' ? 'Vimeo' : 'YouTube'} video found
                    {profile.video_source === 'session' && ' (on a session)'}
                  </p>
                  {profile.video_embed_url && (
                    <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded-lg bg-black">
                      <iframe
                        src={profile.video_embed_url}
                        title="Imported video preview"
                        className="absolute inset-0 h-full w-full"
                        allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  )}
                  <p className="text-[11px] text-text-secondary break-all">{profile.video_url}</p>
                  <p className="text-[10px] text-text-tertiary">
                    Tick “Intro video” above to use it. Only the public link is saved — the
                    video itself is not downloaded or re-hosted.
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-text-tertiary">
                  No YouTube or Vimeo video was found on that page, so your current intro
                  video stays as it is.
                </p>
              )}

              <p className="text-[11px] text-text-tertiary">
                Photos are never imported. Your profile photo stays exactly as it is.
              </p>
            </section>

            {/* Sessions preview */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-text-primary">
                  Imported sessions {sessions.length > 0 && `(${sessions.length})`}
                </h3>
                {sessions.length > 1 && (
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) =>
                        setSessions((prev) => prev.map((s) => ({ ...s, selected: e.target.checked })))
                      }
                      className="cursor-pointer"
                    />
                    Select all
                  </label>
                )}
              </div>

              {sessions.length === 0 && (
                <p className="text-xs text-text-tertiary p-4 rounded-2xl border border-dashed border-border">
                  No sessions were found on this page.
                </p>
              )}

              {sessions.map((session, index) => {
                const duplicate = duplicateFor.get(index);
                return (
                  <div key={index} className="p-4 rounded-2xl border border-border space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex items-start gap-2 cursor-pointer min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={session.selected}
                          onChange={(e) => updateSession(index, { selected: e.target.checked })}
                          className="mt-1.5 cursor-pointer"
                        />
                        <Input
                          value={session.title}
                          onChange={(e) => updateSession(index, { title: e.target.value })}
                          className="text-xs font-bold rounded-lg"
                        />
                      </label>
                      {session.video_url && (
                        <a
                          href={session.video_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[10px] text-text-tertiary hover:text-text-secondary flex items-center gap-1 shrink-0 mt-2"
                        >
                          video <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 pl-6 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary">
                          Duration (minutes)
                        </Label>
                        <Input
                          type="number"
                          value={session.duration_minutes ?? ''}
                          placeholder="not shown publicly"
                          onChange={(e) =>
                            updateSession(index, {
                              duration_minutes: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                          className="text-xs rounded-lg"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary">
                          Price {session.currency ? `(${session.currency})` : ''}
                        </Label>
                        <Input
                          type="number"
                          value={session.price !== null ? session.price / 100 : ''}
                          placeholder="not shown publicly"
                          onChange={(e) =>
                            updateSession(index, {
                              price: e.target.value ? Math.round(Number(e.target.value) * 100) : null,
                            })
                          }
                          className="text-xs rounded-lg"
                        />
                        {session.price !== null && (
                          <p className="text-[10px] text-text-tertiary">{formatPrice(session.price)}</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1 pl-6">
                      <Label className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary">
                        Description (editable)
                      </Label>
                      <Textarea
                        value={session.description || ''}
                        onChange={(e) => updateSession(index, { description: e.target.value })}
                        rows={3}
                        className="text-xs rounded-lg"
                      />
                    </div>

                    {session.price === null && (
                      <p className="pl-6 text-[10px] font-semibold text-amber-700">
                        No price is shown publicly. This will be created as a draft — set a
                        price before publishing it.
                      </p>
                    )}

                    {duplicate && (
                      <div className="pl-6 p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                        <p className="text-[11px] font-bold text-amber-900">
                          Similar session already exists: “{duplicate.existing_title}”
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {([
                            ['update', 'Update existing'],
                            ['create', 'Create new'],
                            ['skip', 'Skip'],
                          ] as Array<[SessionAction, string]>).map(([action, label]) => (
                            <button
                              key={action}
                              type="button"
                              onClick={() =>
                                updateSession(index, { action, selected: action !== 'skip' })
                              }
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer border ${
                                session.action === action
                                  ? 'bg-amber-600 text-white border-amber-600'
                                  : 'bg-surface text-amber-800 border-amber-300 hover:bg-amber-100'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>

            {/* Mode */}
            <section className="space-y-2">
              <h3 className="text-sm font-black text-text-primary">How should this be applied?</h3>
              <div className="space-y-1.5">
                {(Object.keys(MODE_LABELS) as ImportMode[]).map((value) => (
                  <label key={value} className="flex items-start gap-2 text-[11px] text-text-secondary cursor-pointer">
                    <input
                      type="radio"
                      name="import-mode"
                      checked={mode === value}
                      onChange={() => {
                        setMode(value);
                        setConfirmReplace(false);
                      }}
                      className="mt-0.5 cursor-pointer"
                    />
                    <span>{MODE_LABELS[value]}</span>
                  </label>
                ))}
              </div>

              {mode === 'replace' && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 space-y-2">
                  <p className="text-[11px] font-bold text-red-800">
                    This will replace your existing profile information. You can still edit
                    everything before publishing.
                  </p>
                  <label className="flex items-start gap-2 text-[11px] font-semibold text-red-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmReplace}
                      onChange={(e) => setConfirmReplace(e.target.checked)}
                      className="mt-0.5 cursor-pointer"
                    />
                    <span>I understand my current values for the selected fields will be overwritten.</span>
                  </label>
                </div>
              )}
            </section>

            <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:items-center sm:justify-end">
              <Button type="button" variant="outline" onClick={close} className="rounded-xl text-xs cursor-pointer">
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleApply}
                disabled={phase === 'applying'}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl px-5 cursor-pointer disabled:opacity-50"
              >
                {phase === 'applying' ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing…
                  </span>
                ) : (
                  'Import Selected Data'
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- Done step */}
        {phase === 'done' && result && (
          <div className="space-y-4 pt-1">
            <div className="flex items-start gap-2 p-4 rounded-2xl bg-emerald-50 border border-emerald-200">
              <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-xs text-emerald-900 space-y-1">
                <p className="font-bold">{result.message}</p>
                <p>
                  {result.sessions_created} session(s) created, {result.sessions_updated} updated,{' '}
                  {result.sessions_skipped} skipped.
                  {result.profile_fields_applied?.length
                    ? ` Profile fields updated: ${result.profile_fields_applied.join(', ')}.`
                    : ' No profile fields were changed.'}
                </p>
                {result.photo_note && <p>{result.photo_note}</p>}
              </div>
            </div>
            <p className="text-[11px] text-text-tertiary">
              Your public booking URL and payment settings are unchanged — imported sessions
              are sold through your own connected Razorpay account.
            </p>
            <div className="flex justify-end">
              <Button onClick={close} className="rounded-xl text-xs cursor-pointer">
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
