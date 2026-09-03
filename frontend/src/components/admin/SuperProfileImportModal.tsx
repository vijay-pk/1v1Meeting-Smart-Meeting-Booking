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
  booking_url: string | null;
  availability_note: string | null;
  instructions: string | null;
  badge: string | null;
}

interface ParsedProfile {
  name: string | null;
  headline: string | null;
  bio: string | null;
  profile_image_url: string | null;
  cover_image_url: string | null;
  intro_video: string | null;
  social_links: Record<string, string>;
  website: string | null;
  public_links: Array<{ label: string; url: string }>;
}

interface Duplicate {
  session_index: number;
  existing_session_id: string;
  existing_title: string;
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
  { key: 'intro_video', label: 'Intro video', get: (p) => p.intro_video },
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
    return 'Invalid SuperProfile URL. It should look like https://superprofile.bio/your-handle';
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
  const [importImage, setImportImage] = useState(false);
  const [imagePermission, setImagePermission] = useState(false);
  const [mode, setMode] = useState<ImportMode>('add');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [result, setResult] = useState<any>(null);
  // Shown only after an automated fetch is declined: SuperProfile answers 429 to
  // non-browser clients, and imitating a browser to get around that is not something this
  // feature does. The page owner can paste their own page source instead.
  const [pasteMode, setPasteMode] = useState(false);
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
    setImportImage(false);
    setImagePermission(false);
    setMode('add');
    setConfirmReplace(false);
    setResult(null);
    setPasteMode(false);
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
    if (pasteMode && !pageHtml.trim()) {
      setError('Paste the page source, or switch back to importing by URL.');
      return;
    }
    setError('');
    setPhase('loading');
    try {
      const data = await api.importPreview(sourceUrl.trim(), pasteMode ? pageHtml : undefined);
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
      setPhase('preview');
    } catch (e: any) {
      const message = e?.message || 'Unable to access this public page.';
      setError(message);
      // The backend tells the admin to paste the source when the fetch is declined; open
      // that path for them rather than leaving them stuck on a dead end.
      if (message.toLowerCase().includes('paste')) setPasteMode(true);
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
      if (importImage) profileFields.push('profile_image');

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
        import_image: importImage,
        image_permission_confirmed: imagePermission,
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
              <Label className="text-xs font-semibold text-text-secondary">Your public SuperProfile URL</Label>
              <Input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://superprofile.bio/..."
                className="text-xs rounded-xl"
                disabled={phase === 'loading'}
                onKeyDown={(e) => e.key === 'Enter' && phase === 'url' && handlePreview()}
              />
            </div>

            {pasteMode && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-text-secondary">Page source</Label>
                <Textarea
                  value={pageHtml}
                  onChange={(e) => setPageHtml(e.target.value)}
                  rows={5}
                  placeholder="Open your SuperProfile page in the browser, press Ctrl+U (View source), select all, and paste it here."
                  className="text-[11px] rounded-xl font-mono"
                  disabled={phase === 'loading'}
                />
                <button
                  type="button"
                  onClick={() => { setPasteMode(false); setPageHtml(''); setError(''); }}
                  className="text-[11px] font-semibold text-indigo-600 hover:underline cursor-pointer"
                >
                  Import by URL instead
                </button>
              </div>
            )}

            <p className="text-[11px] text-text-tertiary leading-relaxed">
              Only import content you have permission to reuse. This reads the public page
              only — it does not sign in to SuperProfile, and it does not work around any
              access control. Your booking link, payment settings and calendar connection are
              never changed by an import.
            </p>

            {!pasteMode && (
              <button
                type="button"
                onClick={() => setPasteMode(true)}
                className="text-[11px] font-semibold text-text-tertiary hover:text-text-secondary hover:underline cursor-pointer"
              >
                SuperProfile blocking the import? Paste the page source instead
              </button>
            )}

            <Button
              onClick={handlePreview}
              disabled={phase === 'loading'}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl px-5 py-2.5 cursor-pointer"
            >
              {phase === 'loading' ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the page…
                </span>
              ) : (
                'Preview Import'
              )}
            </Button>
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
                {profile.profile_image_url ? (
                  <div className="space-y-1.5 shrink-0">
                    <img
                      src={profile.profile_image_url}
                      alt="Imported profile"
                      className="w-16 h-16 rounded-xl object-cover border border-border"
                    />
                    <p className="text-[9px] text-text-tertiary w-16 text-center">preview only</p>
                  </div>
                ) : null}

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

              {profile.profile_image_url && (
                <div className="p-3 rounded-xl border border-border space-y-2">
                  <label className="flex items-start gap-2 text-[11px] text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importImage}
                      onChange={(e) => setImportImage(e.target.checked)}
                      className="mt-0.5 cursor-pointer"
                    />
                    <span>Import this profile image into my media library</span>
                  </label>
                  {importImage && (
                    <label className="flex items-start gap-2 text-[11px] font-semibold text-slate-800 cursor-pointer pl-5">
                      <input
                        type="checkbox"
                        checked={imagePermission}
                        onChange={(e) => setImagePermission(e.target.checked)}
                        className="mt-0.5 cursor-pointer"
                      />
                      <span>
                        I confirm I have permission to reuse this image. It will be copied
                        into this platform's storage rather than linked from SuperProfile.
                      </span>
                    </label>
                  )}
                </div>
              )}
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
                      {session.booking_url && (
                        <a
                          href={session.booking_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[10px] text-text-tertiary hover:text-text-secondary flex items-center gap-1 shrink-0 mt-2"
                        >
                          source <ExternalLink className="w-3 h-3" />
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
                {result.image_note && <p className="text-amber-800">{result.image_note}</p>}
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
