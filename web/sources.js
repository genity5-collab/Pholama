// "Sites visited" card: shows every site the AI looked at, with a safe link and a preview picture when the page has one.
// Used by the chat and by Studio. Nothing is inserted as HTML; every value goes in as plain text or a checked attribute.
const SAFE = /^https?:\/\//i;

export function sourcesCard(list) {
  const box = document.createElement('div'); box.className = 'srcs';
  const head = document.createElement('div'); head.className = 'srcs-h'; box.appendChild(head);
  const body = document.createElement('div'); body.className = 'srcs-b'; box.appendChild(body);
  function paint(items) {
    items = (items || []).filter(x => x && SAFE.test(x.url || ''));
    head.textContent = items.length ? 'Sites the AI looked at (' + items.length + ')' : '';
    box.style.display = items.length ? '' : 'none';
    body.textContent = '';
    for (const it of items) {
      const row = document.createElement('div'); row.className = 'src';
      if (it.image && SAFE.test(it.image)) {
        const a = document.createElement('a'); a.href = it.url; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; a.className = 'src-img';
        const im = document.createElement('img'); im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.alt = it.title || it.host || 'preview'; im.src = it.image;
        im.onerror = () => a.remove(); a.appendChild(im); row.appendChild(a);
      }
      const txt = document.createElement('div'); txt.className = 'src-t';
      const a = document.createElement('a'); a.href = it.url; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; a.className = 'src-l'; a.textContent = it.title || it.host || it.url; txt.appendChild(a);
      const host = document.createElement('div'); host.className = 'src-h'; host.textContent = (it.host || '') + (it.how ? '  ·  ' + it.how : ''); txt.appendChild(host);
      if (it.snippet) { const sn = document.createElement('div'); sn.className = 'src-s'; sn.textContent = it.snippet; txt.appendChild(sn); }
      if (it.warn && it.warn.length) { const w = document.createElement('div'); w.className = 'src-w'; w.textContent = 'Careful: ' + it.warn.join('; '); txt.appendChild(w); }
      row.appendChild(txt); body.appendChild(row);
    }
  }
  paint(list);
  return { el: box, update: paint };
}
