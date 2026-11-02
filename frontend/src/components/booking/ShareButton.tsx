import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { buildPublicProfileUrl } from '@/lib/publicUrl';

/**
 * Shares the host's permanent booking URL (built from their username by lib/publicUrl, never from
 * whatever address the visitor happens to be on). Uses the native share sheet where the browser has
 * one and always offers copy-link and the usual networks as the fallback.
 */
export const ShareButton: React.FC<{ username: string; hostName: string }> = ({ username, hostName }) => {
  const url = buildPublicProfileUrl(username);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!url) return null;
  const text = `Book a 1:1 session with ${hostName || 'this host'}`;

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // Older browsers / insecure contexts: fall back to a temporary textarea.
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const onClick = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: hostName, text, url });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return; // the visitor closed the sheet
      }
    }
    setOpen((o) => !o);
  };

  const enc = encodeURIComponent(url);
  const encText = encodeURIComponent(text);
  const itemCls = 'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm bm-text hover:bg-[var(--bm-chip)]';

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Share this booking page"
        className="bm-ghost inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold transition"
      >
        <Share2 className="h-4 w-4" />
        <span className="hidden sm:inline">Share</span>
      </button>
      {open && (
        <div role="menu" className="bm-card absolute right-0 z-40 mt-2 w-56 p-1.5">
          <button role="menuitem" type="button" onClick={copy} className={itemCls}>
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <a role="menuitem" className={itemCls} target="_blank" rel="noreferrer" href={`https://api.whatsapp.com/send?text=${encText}%20${enc}`}>WhatsApp</a>
          <a role="menuitem" className={itemCls} target="_blank" rel="noreferrer" href={`https://www.linkedin.com/sharing/share-offsite/?url=${enc}`}>LinkedIn</a>
          <a role="menuitem" className={itemCls} target="_blank" rel="noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${enc}`}>Facebook</a>
        </div>
      )}
    </div>
  );
};
