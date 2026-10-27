/** Small feel-good helpers. Every one of them degrades to a no-op where unsupported. */
export const haptic = (pattern = 12) => { try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; navigator.vibrate?.(pattern); } catch { /* unsupported */ } };

/** Native share sheet on phones, clipboard elsewhere. Returns 'shared' | 'copied' | 'failed'. */
export async function shareLink({ title, text, url = window.location.href }) {
  try {
    if (navigator.share) { await navigator.share({ title, text, url }); return 'shared'; }
    await navigator.clipboard.writeText(`${text ? `${text} ` : ''}${url}`);
    return 'copied';
  } catch (e) { return e?.name === 'AbortError' ? 'shared' : 'failed'; }
}
