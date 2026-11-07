/**
 * Per-page <title>, description, canonical and Open Graph tags for a client-rendered page.
 * Search engines that render JavaScript read these; each public booking page therefore carries
 * its own host's name and bio instead of the generic site description. Returns a restore
 * function so leaving the page puts the defaults back.
 */
interface PageMeta {
  title: string;
  description?: string;
  canonicalPath?: string;
  image?: string | null;
  noindex?: boolean;
}

function setMeta(attr: 'name' | 'property', key: string, content: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (content === null) { el?.remove(); return; }
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute('content', content);
}

export function applyPageMeta(meta: PageMeta): () => void {
  const prevTitle = document.title;
  const read = (attr: 'name' | 'property', key: string) =>
    document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)?.getAttribute('content') ?? null;
  const prev = {
    description: read('name', 'description'),
    ogTitle: read('property', 'og:title'),
    ogDescription: read('property', 'og:description'),
    ogImage: read('property', 'og:image'),
    robots: read('name', 'robots'),
  };
  const prevCanonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const prevCanonicalHref = prevCanonical?.getAttribute('href') ?? null;

  document.title = meta.title;
  if (meta.description) {
    setMeta('name', 'description', meta.description);
    setMeta('property', 'og:description', meta.description);
  }
  setMeta('property', 'og:title', meta.title);
  if (meta.image) setMeta('property', 'og:image', meta.image);
  setMeta('name', 'robots', meta.noindex ? 'noindex, nofollow' : null);
  if (meta.canonicalPath) {
    const origin = import.meta.env.VITE_APP_URL || window.location.origin;
    let link = prevCanonical;
    if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
    link.href = `${origin}${meta.canonicalPath}`;
  }

  return () => {
    document.title = prevTitle;
    setMeta('name', 'description', prev.description);
    setMeta('property', 'og:title', prev.ogTitle);
    setMeta('property', 'og:description', prev.ogDescription);
    setMeta('property', 'og:image', prev.ogImage);
    setMeta('name', 'robots', prev.robots);
    const link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (link) { if (prevCanonicalHref === null) link.remove(); else link.href = prevCanonicalHref; }
  };
}
