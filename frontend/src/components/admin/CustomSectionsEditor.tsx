import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Loader2, Plus, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { getVideoEmbedUrl } from '@/lib/video';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { IntroVideoPlayer } from '@/components/ui/IntroVideoPlayer';
import { PublicSectionBlock } from '@/components/booking/PublicSections';
import type { ProfileSection, ProfileSectionItem } from '@/types';

/** A section as edited in Settings: the saved shape plus a stable client key for React. */
export type EditorItem = ProfileSectionItem & { _key: string };
export type EditorSection = Omit<ProfileSection, 'items'> & { _key: string; items?: EditorItem[] };

let counter = 0;
const key = () => `k${Date.now().toString(36)}${counter++}`;

export const withKeys = (list: ProfileSection[]): EditorSection[] =>
  list.map((s) => ({ ...s, _key: s.id || key(), items: (s.items || []).map((i) => ({ ...i, _key: i.id || key() })) }));

/** What goes to the server: no client keys, no resolved URLs (assets are referenced by id). */
export const toPayload = (list: EditorSection[]): ProfileSection[] =>
  list.map(({ _key, items, image_url, ...s }) => ({
    ...s,
    items: (items || []).map(({ _key: _k, image_url: _u, ...i }) => i),
  }));

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 8 * 1024 * 1024;

const label = 'text-[11px] font-semibold text-text-secondary';
const field = 'text-xs rounded-lg bg-surface h-9';

/** Upload / preview / replace / remove for one image, plus its caption (alt text). */
const ImageField: React.FC<{
  url?: string | null;
  alt?: string | null;
  onChange: (v: { asset_id: string | null; url: string | null }) => void;
  onAlt: (v: string) => void;
  title?: string;
}> = ({ url, alt, onChange, onAlt, title = 'Image' }) => {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (file?: File | null) => {
    if (!file) return;
    setError('');
    if (!ALLOWED.includes(file.type)) { setError('Use a JPG, PNG or WebP image.'); return; }
    if (file.size > MAX_BYTES) { setError('That image is over 8 MB. Choose a smaller one.'); return; }
    setBusy(true);
    try {
      const r = await api.uploadMedia(file, 'photo');
      onChange({ asset_id: r.saved_as, url: r.url });
    } catch (e: any) {
      setError(e?.message || 'The upload failed. Your current image is unchanged.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-1.5">
      <span className={label}>{title} <span className="font-normal text-text-tertiary">(optional)</span></span>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {url ? (
        <div className="flex items-start gap-3">
          <img src={url} alt={alt || ''} className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Input value={alt || ''} onChange={(e) => onAlt(e.target.value)} maxLength={200} placeholder="Caption / description (optional)" className={field} />
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => input.current?.click()} className="text-[11px] font-semibold text-primary-600 hover:underline">
                {busy ? 'Uploading…' : 'Replace'}
              </button>
              <button type="button" disabled={busy} onClick={() => onChange({ asset_id: null, url: null })} className="text-[11px] font-semibold text-red-600 hover:underline">
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={() => input.current?.click()}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface px-3 text-xs font-medium text-text-secondary hover:bg-surface-secondary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {busy ? 'Uploading…' : 'Upload image (JPG, PNG or WebP, up to 8 MB)'}
        </button>
      )}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
};

/** A YouTube or Vimeo link. Anything else is flagged here and refused again by the server. */
const VideoField: React.FC<{ value?: string | null; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const v = (value || '').trim();
  const valid = !v || getVideoEmbedUrl(v) !== null;
  return (
    <div className="space-y-1.5">
      <span className={label}>Video link <span className="font-normal text-text-tertiary">(YouTube or Vimeo, optional)</span></span>
      <Input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="https://youtube.com/watch?v=… or https://vimeo.com/…" className={field} />
      {!valid && <p className="text-[11px] text-red-600">Only YouTube and Vimeo links are supported.</p>}
      {v && valid && <div className="max-w-xs overflow-hidden rounded-lg"><IntroVideoPlayer url={v} /></div>}
    </div>
  );
};

const Toolbar: React.FC<{ index: number; count: number; published?: boolean; onMove: (d: -1 | 1) => void; onPublish: (v: boolean) => void; onRemove: () => void; name: string }> = ({
  index, count, published, onMove, onPublish, onRemove, name,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <span className="text-[11px] font-bold text-text-secondary">{name} #{index + 1}</span>
    <div className="flex items-center gap-1.5">
      <label className="mr-1 flex items-center gap-1.5 text-[11px] text-text-secondary">
        <Switch checked={published !== false} onCheckedChange={onPublish} aria-label="Published" />
        {published !== false ? 'Published' : 'Hidden'}
      </label>
      <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)} className="rounded p-1.5 text-text-tertiary hover:bg-surface disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
      <button type="button" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)} className="rounded p-1.5 text-text-tertiary hover:bg-surface disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
      <button type="button" aria-label="Remove" onClick={onRemove} className="rounded p-1.5 text-text-tertiary hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  </div>
);

const move = <T,>(arr: T[], i: number, d: -1 | 1): T[] => {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const next = arr.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

export const CustomSectionsEditor: React.FC<{
  sections: EditorSection[];
  onChange: (next: EditorSection[]) => void;
  /** CSS variables of the host's theme, so the preview matches the public page. */
  previewStyle: React.CSSProperties;
  disabled?: boolean;
}> = ({ sections, onChange, previewStyle, disabled }) => {
  const [preview, setPreview] = useState<Record<string, boolean>>({});

  const patch = (k: string, p: Partial<EditorSection>) => onChange(sections.map((s) => (s._key === k ? { ...s, ...p } : s)));
  const patchItem = (k: string, ik: string, p: Partial<EditorItem>) =>
    patch(k, { items: (sections.find((s) => s._key === k)?.items || []).map((i) => (i._key === ik ? { ...i, ...p } : i)) });

  const add = (kind: 'info' | 'testimonials') =>
    onChange([...sections, { _key: key(), kind, title: '', is_published: true, items: kind === 'testimonials' ? [{ _key: key(), is_published: true }] : [] }]);

  return (
    <div className={`space-y-3 ${disabled ? 'pointer-events-none opacity-60' : ''}`}>
      {sections.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-text-tertiary">
          No custom sections yet. Add a resource card, or a reviews/testimonials section, to show on your public page.
        </div>
      )}

      {sections.map((sec, idx) => {
        const items = sec.items || [];
        const shown = preview[sec._key];
        return (
          <div key={sec._key} className="space-y-3 rounded-xl border border-border bg-surface-secondary/70 p-3.5">
            <Toolbar name={sec.kind === 'testimonials' ? 'Testimonials' : 'Section'} index={idx} count={sections.length} published={sec.is_published}
              onMove={(d) => onChange(move(sections, idx, d))} onPublish={(v) => patch(sec._key, { is_published: v })}
              onRemove={() => onChange(sections.filter((s) => s._key !== sec._key))} />

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <span className={label}>Section title</span>
                <Input value={sec.title} maxLength={120} onChange={(e) => patch(sec._key, { title: e.target.value })}
                  placeholder={sec.kind === 'testimonials' ? 'e.g. Student Testimonials' : 'e.g. Free Guides'} className={`${field} font-semibold`} />
              </div>
              <div className="space-y-1">
                <span className={label}>Badge tag <span className="font-normal text-text-tertiary">(optional)</span></span>
                <Input value={sec.badge || ''} maxLength={40} onChange={(e) => patch(sec._key, { badge: e.target.value })} placeholder="e.g. Free, Popular" className={field} />
              </div>
            </div>
            <div className="space-y-1">
              <span className={label}>Description <span className="font-normal text-text-tertiary">(optional)</span></span>
              <textarea value={sec.description || ''} maxLength={2000} rows={2} onChange={(e) => patch(sec._key, { description: e.target.value })}
                placeholder="Short description or benefits for clients" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary-500/30" />
            </div>

            {sec.kind === 'info' && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ImageField url={sec.image_url} alt={sec.image_alt}
                    onChange={(v) => patch(sec._key, { image_asset_id: v.asset_id, image_url: v.url, ...(v.asset_id ? {} : { image_alt: '' }) })}
                    onAlt={(t) => patch(sec._key, { image_alt: t })} />
                  <VideoField value={sec.video_url} onChange={(t) => patch(sec._key, { video_url: t })} />
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div className="space-y-1">
                    <span className={label}>Button label <span className="font-normal text-text-tertiary">(optional)</span></span>
                    <Input value={sec.button_text || ''} maxLength={40} onChange={(e) => patch(sec._key, { button_text: e.target.value })} placeholder="e.g. Download PDF" className={field} />
                  </div>
                  <div className="space-y-1">
                    <span className={label}>Button destination <span className="font-normal text-text-tertiary">(https://…)</span></span>
                    <Input value={sec.button_url || ''} maxLength={500} onChange={(e) => patch(sec._key, { button_url: e.target.value })} placeholder="https://…" className={field} />
                  </div>
                </div>
              </>
            )}

            {sec.kind === 'testimonials' && (
              <div className="space-y-2.5">
                {items.map((it, ii) => (
                  <div key={it._key} className="space-y-2.5 rounded-lg border border-border bg-surface p-3">
                    <Toolbar name="Testimonial" index={ii} count={items.length} published={it.is_published}
                      onMove={(d) => patch(sec._key, { items: move(items, ii, d) })} onPublish={(v) => patchItem(sec._key, it._key, { is_published: v })}
                      onRemove={() => patch(sec._key, { items: items.filter((x) => x._key !== it._key) })} />
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <Input value={it.customer_name || ''} maxLength={80} onChange={(e) => patchItem(sec._key, it._key, { customer_name: e.target.value })} placeholder="Customer name" className={field} />
                      <Input value={it.designation || ''} maxLength={120} onChange={(e) => patchItem(sec._key, it._key, { designation: e.target.value })} placeholder="Designation / description (optional)" className={field} />
                    </div>
                    <textarea value={it.text || ''} maxLength={1000} rows={2} onChange={(e) => patchItem(sec._key, it._key, { text: e.target.value })}
                      placeholder="Their review or testimonial" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary-500/30" />
                    <Input value={it.badge || ''} maxLength={40} onChange={(e) => patchItem(sec._key, it._key, { badge: e.target.value })} placeholder="Badge (optional, e.g. Success Story). Shown exactly as typed." className={field} />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <ImageField title="Customer photo / image" url={it.image_url} alt={it.image_alt}
                        onChange={(v) => patchItem(sec._key, it._key, { image_asset_id: v.asset_id, image_url: v.url, ...(v.asset_id ? {} : { image_alt: '' }) })}
                        onAlt={(t) => patchItem(sec._key, it._key, { image_alt: t })} />
                      <VideoField value={it.video_url} onChange={(t) => patchItem(sec._key, it._key, { video_url: t })} />
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => patch(sec._key, { items: [...items, { _key: key(), is_published: true }] })}
                  className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs font-medium text-text-secondary hover:bg-surface">
                  <Plus className="h-3.5 w-3.5" /> Add testimonial
                </button>
              </div>
            )}

            <button type="button" onClick={() => setPreview((p) => ({ ...p, [sec._key]: !p[sec._key] }))}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary-600 hover:underline">
              {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {shown ? 'Hide preview' : 'Preview on your page'}
            </button>
            {shown && (
              <div className="bm-page overflow-hidden rounded-xl p-3 sm:p-4" style={{ ...previewStyle, minHeight: 0 }}>
                <PublicSectionBlock section={{ ...sec, items: items.filter((i) => i.is_published !== false) }} />
                {sec.is_published === false && <p className="mt-2 flex items-center gap-1 text-[11px] bm-onbg-muted"><X className="h-3 w-3" /> Hidden: visitors will not see this section.</p>}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => add('info')} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-xs font-bold text-white hover:bg-slate-800">
          <Plus className="h-3.5 w-3.5" /> Add section
        </button>
        <button type="button" onClick={() => add('testimonials')} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface text-xs font-bold text-text-primary hover:bg-surface-secondary">
          <Plus className="h-3.5 w-3.5" /> Add reviews / testimonials
        </button>
      </div>
    </div>
  );
};
