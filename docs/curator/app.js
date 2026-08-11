const DB_NAME = 'the-curator';
const STORE = 'gallery';
const CURRENT = 'current';
const DROPBOX_TOKEN = 'dropbox-token';
const DROPBOX_APP_KEY = 'q0q03vfz682exrg';
const DROPBOX_PATH = '/The_Docent_Gallery_Latest.json';
const LEGACY_DROPBOX_PATH = '/The_Curator_Gallery_Latest.json';

const app = document.querySelector('#app');
const packageInput = document.querySelector('#package-input');
let gallery = null;
let deferredInstall = null;
let searchQuery = '';
let activeProject = 'All';
let activeType = 'All';
let activeTag = 'All';
let detailSide = 'image';
let activeDetailWorkId = null;
let artMenuOpen = false;
let galleryScrollY = 0;
let detailExpanded = false;
let quoteCycleTimer = null;
let quoteQueue = [];
let quoteQueueSignature = '';
let lastQuoteText = '';

const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const updateVisualViewport = () => {
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--docent-viewport-height', `${Math.round(height)}px`);
};
updateVisualViewport();
const validPackage = value => Boolean(value && ['the-archivist.docent-gallery', 'the-archivist.curator-gallery', 'the-archivist.gallery'].includes(value.schema) && value.schemaVersion === 1 && Array.isArray(value.works));
const isImageWork = work => ['drawing', 'image', 'photography', 'painting', 'illustration', 'sculpture'].includes(String(work.type || work.medium || '').toLowerCase());
const isMusicWork = work => ['music', 'audio', 'song', 'sound', 'album', 'recording'].includes(String(work.type || work.medium || '').toLowerCase()) || String(work.mimeType || '').startsWith('audio/');
const isVideoWork = work => ['video', 'film', 'animation', 'motion'].includes(String(work.type || work.medium || '').toLowerCase()) || String(work.mimeType || '').startsWith('video/');
const isPoetryWork = work => ['poetry', 'poem'].includes(String(work.type || work.medium || '').toLowerCase());
const matchesCategory = (work, category) => category === 'All'
  || (category === 'Images' && isImageWork(work))
  || (category === 'Music' && isMusicWork(work))
  || (category === 'Video' && isVideoWork(work))
  || (work.type || work.medium) === category;
const workMediaSource = work => work.media?.src || '';
const workExternalUrl = work => {
  const candidates = [work.externalUrl, work.external_url, work.sourceUrl, work.remoteUrl, work.url, work.previewUrl, work.metadata?.external_url, work.metadata?.sourceUrl];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(String(candidate || ''));
      if (['http:', 'https:'].includes(parsed.protocol)) return parsed.href;
    } catch { /* Try the next legacy field. */ }
  }
  const thumbnailMatch = String(work.image || '').match(/^https:\/\/img\.youtube\.com\/vi\/([^/?#]{11})\//i);
  return thumbnailMatch ? `https://www.youtube.com/watch?v=${thumbnailMatch[1]}` : '';
};
const linkedAppUrl = url => {
  const youtube = String(url).match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?/\s]{11})/i);
  if (youtube) return `youtube://watch?v=${youtube[1]}`;
  try {
    const parsed = new URL(url);
    const spotify = parsed.hostname.endsWith('spotify.com') && parsed.pathname.match(/^\/(track|album|playlist|episode|show|artist)\/([^/?#]+)/i);
    if (spotify) return `spotify:${spotify[1].toLowerCase()}:${spotify[2]}`;
  } catch { /* The safe web URL remains the fallback. */ }
  return '';
};
const openLinkedWork = work => {
  const url = workExternalUrl(work);
  if (!url) return false;
  const youtube = String(url).match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?/\s]{11})/i);
  if (youtube) {
    location.assign(`https://www.youtube.com/watch?v=${youtube[1]}`);
    return true;
  }
  const appUrl = linkedAppUrl(url);
  if (appUrl) {
    let fallbackTimer;
    const cancelFallback = () => {
      if (document.visibilityState === 'hidden') clearTimeout(fallbackTimer);
      document.removeEventListener('visibilitychange', cancelFallback);
    };
    document.addEventListener('visibilitychange', cancelFallback);
    location.href = appUrl;
    fallbackTimer = setTimeout(() => {
      document.removeEventListener('visibilitychange', cancelFallback);
      location.href = url;
    }, 1100);
    return true;
  }
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
};
const sourceLaunchUrl = work => {
  const url = workExternalUrl(work);
  const youtube = String(url).match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?/\s]{11})/i);
  return youtube ? `https://www.youtube.com/watch?v=${youtube[1]}` : url;
};
const sourceLaunchLabel = work => /(?:youtube\.com|youtu\.be)/i.test(workExternalUrl(work)) ? 'Open in YouTube' : 'Open source';
const workCardVisual = work => {
  const source = work.image || (String(work.media?.mimeType || '').startsWith('image/') ? workMediaSource(work) : '');
  if (source) return `<img src="${source}" alt="${escapeHtml(work.title)}" loading="lazy">`;
  const kind = isMusicWork(work) ? 'Music' : isVideoWork(work) ? 'Video' : (work.type || work.medium || 'Archive');
  const excerpt = work.text || work.description || work.critique || '';
  return `<span class="media-placeholder media-${escapeHtml(kind.toLowerCase())}"><strong>${escapeHtml(kind)}</strong>${excerpt ? `<em>${escapeHtml(excerpt.slice(0, 180))}</em>` : '<em>Open the card to view</em>'}</span>`;
};
const workDetailFront = work => {
  const media = workMediaSource(work);
  if (work.media?.mimeType === 'application/pdf' && media) return `<div class="pdf-reader" data-pdf-reader><div class="pdf-reader-toolbar"><span data-pdf-status>Preparing PDF…</span><button data-open-pdf>Open in PDF app ↗</button></div><div class="pdf-pages" data-pdf-pages></div></div>`;
  if (isVideoWork(work) && media) return `<video src="${media}" controls playsinline ${work.image ? `poster="${work.image}"` : ''}></video>`;
  if (isMusicWork(work) && media) return `<div class="audio-front">${work.image ? `<img src="${work.image}" alt="${escapeHtml(work.title)}">` : '<span class="audio-mark">♪</span>'}<h2>${escapeHtml(work.title)}</h2><audio src="${media}" controls></audio></div>`;
  const image = work.image || (String(work.media?.mimeType || '').startsWith('image/') ? media : '');
  if (image) return `<img src="${image}" alt="${escapeHtml(work.title)}">`;
  if (isPoetryWork(work) && work.text) return `<div class="text-front poetry-front"><p class="eyebrow">Poetry</p><h2>${escapeHtml(work.title)}</h2><p>Turn the card over to read the transcription.</p></div>`;
  return `<div class="text-front"><p class="eyebrow">${escapeHtml(work.type || work.medium || 'Archive work')}</p><h2>${escapeHtml(work.title)}</h2><p>${escapeHtml(work.text || work.description || 'Turn the card over for its Archivist record.')}</p></div>`;
};

const dataUrlBytes = source => {
  const encoded = String(source || '').split(',')[1] || '';
  const binary = atob(encoded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

const hydratePdfReader = async work => {
  const reader = document.querySelector('[data-pdf-reader]');
  if (!reader || work.media?.mimeType !== 'application/pdf') return;
  const status = reader.querySelector('[data-pdf-status]');
  const pages = reader.querySelector('[data-pdf-pages]');
  try {
    const bytes = dataUrlBytes(workMediaSource(work));
    const pdfjs = await import('./vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    if (!reader.isConnected) return;
    status.textContent = `${pdf.numPages} ${pdf.numPages === 1 ? 'page' : 'pages'}`;
    const availableWidth = Math.max(280, Math.min(1100, reader.clientWidth - 24));
    for (let number = 1; number <= pdf.numPages; number += 1) {
      if (!reader.isConnected) return;
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const cssScale = availableWidth / base.width;
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: cssScale * pixelRatio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`;
      canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`;
      canvas.setAttribute('aria-label', `Page ${number}`);
      pages.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
    reader.querySelector('[data-open-pdf]')?.addEventListener('click', () => {
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    });
  } catch (error) {
    status.textContent = 'PDF could not be rendered';
    pages.innerHTML = `<p class="pdf-error">${escapeHtml(error?.message || 'Try opening this PDF in its native app.')}</p>`;
  }
};

const currentCollectionWorks = () => {
  const query = searchQuery.trim().toLowerCase();
  return (gallery?.works || []).filter(work => {
    if (!matchesCategory(work, activeType)) return false;
    if (activeProject !== 'All' && !work.projects?.includes(activeProject)) return false;
    if (activeTag !== 'All' && !work.tags?.includes(activeTag)) return false;
    const haystack = [work.title, work.medium, work.type, work.dimensions, work.date, work.description, work.catalogId, work.text, ...(work.projects || []), ...(work.tags || [])].join(' ').toLowerCase();
    return !query || haystack.includes(query);
  });
};
const setCardViewLock = locked => {
  if (locked) window.scrollTo(0, 0);
  document.documentElement.classList.toggle('card-view-open', locked);
  document.body.classList.toggle('card-view-open', locked);
};

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const readValue = async key => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

const readStoredGallery = () => readValue(CURRENT);

const storeGallery = async value => {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, CURRENT);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  gallery = value;
};

const storeValue = async (key, value) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
};

const base64Url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomUrlValue = size => base64Url(crypto.getRandomValues(new Uint8Array(size)));
const sha256 = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const oauthRedirectUri = () => `${location.origin}${location.pathname}`;

const connectDropbox = async () => {
  const verifier = randomUrlValue(48);
  const state = randomUrlValue(24);
  sessionStorage.setItem('curator-dropbox-verifier', verifier);
  sessionStorage.setItem('curator-dropbox-state', state);
  const authorization = new URL('https://www.dropbox.com/oauth2/authorize');
  authorization.search = new URLSearchParams({
    client_id: DROPBOX_APP_KEY,
    response_type: 'code',
    redirect_uri: oauthRedirectUri(),
    code_challenge: base64Url(await sha256(verifier)),
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    scope: 'files.content.read files.metadata.read',
    state
  });
  location.assign(authorization);
};

const exchangeDropboxCode = async code => {
  const verifier = sessionStorage.getItem('curator-dropbox-verifier');
  if (!verifier) throw new Error('The Dropbox connection expired. Please try again.');
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: oauthRedirectUri(), client_id: DROPBOX_APP_KEY, code_verifier: verifier })
  });
  const token = await response.json();
  if (!response.ok) throw new Error(token.error_description || 'Dropbox could not connect.');
  const stored = { accessToken: token.access_token, refreshToken: token.refresh_token || '', expiresAt: Date.now() + ((token.expires_in || 14400) * 1000) };
  await storeValue(DROPBOX_TOKEN, stored);
  return stored;
};

const getDropboxAccessToken = async () => {
  const stored = await readValue(DROPBOX_TOKEN);
  if (!stored) return null;
  if (stored.accessToken && stored.expiresAt > Date.now() + 60000) return stored.accessToken;
  if (!stored.refreshToken) return null;
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: stored.refreshToken, client_id: DROPBOX_APP_KEY })
  });
  const token = await response.json();
  if (!response.ok) return null;
  const updated = { ...stored, accessToken: token.access_token, expiresAt: Date.now() + ((token.expires_in || 14400) * 1000) };
  await storeValue(DROPBOX_TOKEN, updated);
  return updated.accessToken;
};

const syncDropbox = async ({ quiet = false } = {}) => {
  const accessToken = await getDropboxAccessToken();
  if (!accessToken) {
    if (!quiet) await connectDropbox();
    return false;
  }
  let response;
  for (const path of [DROPBOX_PATH, LEGACY_DROPBOX_PATH]) {
    response = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Arg': JSON.stringify({ path }) }
    });
    if (response.status !== 409) break;
  }
  if (response.status === 409) {
    if (!quiet) alert('No Docent gallery has been published from Archivist yet.');
    return false;
  }
  if (!response.ok) throw new Error('The Docent could not download the Dropbox gallery.');
  const value = await response.json();
  if (!validPackage(value)) throw new Error('Dropbox returned an invalid Docent gallery.');
  if (gallery?.version && gallery.version === value.version) return true;
  await storeGallery(value);
  renderGallery();
  return true;
};

const formatDate = value => {
  if (!value) return '';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

const formatSync = value => {
  if (!value) return 'Stored offline';
  return `Stored offline · updated ${new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
};

const renderTopbar = () => {
  const works = gallery?.works || [];
  const mediaCounts = works.reduce((counts, work) => {
    const medium = work.type || work.medium || 'Unclassified';
    counts[medium] = (counts[medium] || 0) + 1;
    return counts;
  }, {});
  const mostUsed = Object.entries(mediaCounts).sort(([, left], [, right]) => right - left)[0]?.[0] || '—';
  const projects = new Set(works.flatMap(work => work.projects || []));
  const years = works.map(work => String(work.date || '').slice(0, 4)).filter(year => /^\d{4}$/.test(year)).map(Number).sort();
  const dateRange = years.length ? (years[0] === years[years.length - 1] ? years[0] : `${years[0]}–${years[years.length - 1]}`) : '—';
  const snapshot = [
    ['Vault files', works.length],
    ['Projects', projects.size],
    ['Media types', Object.keys(mediaCounts).filter(type => type !== 'Unclassified').length],
    ['Most used', mostUsed],
    ['Date range', dateRange],
    ['On device', gallery ? 'Ready' : 'Empty']
  ];
  return `<header class="topbar">
    <button class="brand-lockup" data-home aria-label="Return to collection"><span class="nav-logo"><img src="./docent-icon-512.png" alt=""></span><span><strong>Docent</strong><em>by The Archivist</em></span></button>
    <nav class="universal-nav" aria-label="Archive snapshot">${snapshot.map(([label, value]) => `<button data-stats><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></button>`).join('')}</nav>
    <div class="top-actions"><span class="offline-dot"></span><span class="sync-label">${escapeHtml(formatSync(gallery?.publishedAt))}</span><button class="icon-button" data-dropbox aria-label="Sync Dropbox" title="Sync Dropbox">↻</button><button class="icon-button" data-import aria-label="Import update" title="Import update">↥</button></div>
  </header><div class="stats-modal" data-stats-modal aria-hidden="true"><section class="stats-modal-card"><button class="stats-modal-close" data-stats-close aria-label="Close statistics">×</button><p class="eyebrow">Vault statistics</p><h2>The collection at a glance</h2><div class="stats-modal-grid">${snapshot.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div><p>Tap outside this panel to close.</p></section></div>`;
};

const renderDock = () => {
  if (!gallery?.works?.length) return '';
  const categoryIcons = {
    home: '<svg viewBox="0 0 24 24"><path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></svg>',
    images: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
    anthology: '<svg viewBox="0 0 24 24"><path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2Zm0 14a2 2 0 0 1 2-2h12"/></svg>',
    reading: '<svg viewBox="0 0 24 24"><path d="M4 19V5m5 14V5m5 14V5m5 14-3-14"/></svg>',
    music: '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13M9 9l11-2"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
    video: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/></svg>',
    profile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>'
  };
  const categories = [['All', 'Home', 'home'], ['Images', 'Images', 'images'], ['Poetry', 'Poetry', 'anthology'], ['Writing', 'Writing', 'reading'], ['Music', 'Music', 'music'], ['Video', 'Video', 'video'], ['Profile', 'Profile', 'profile']];
  return `<button class="art-menu-scrim ${artMenuOpen ? 'is-open' : ''}" data-art-menu-dismiss aria-label="Close category menu"></button><aside class="art-menu ${artMenuOpen ? 'is-open' : ''}" aria-label="Browse artwork categories">
    <button class="art-menu-handle" data-art-menu-toggle aria-label="${artMenuOpen ? 'Close' : 'Open'} category menu"><span></span></button>
    <div class="art-menu-panel">
      <header><span>Browse</span><strong>The Docent</strong></header>
      <nav>${categories.map(([value, label, icon]) => {
        const count = value === 'Profile' ? gallery.profile?.evaluationCorpusSize || gallery.works.length : gallery.works.filter(work => matchesCategory(work, value)).length;
        return `<button data-menu-category="${value}" class="category-${icon} ${activeType === value ? 'is-current' : ''}"><span class="category-icon">${categoryIcons[icon]}</span><span><strong>${label}</strong><em>${value === 'Profile' ? `${count} works evaluated` : `${count} ${count === 1 ? 'work' : 'works'}`}</em></span></button>`;
      }).join('')}</nav>
    </div>
  </aside>`;
};

const renderEmpty = () => {
  setCardViewLock(false);
  app.innerHTML = `${renderTopbar()}<main class="empty has-topbar">
    <div class="monogram docent-monogram"><img src="./docent-icon-512.png" alt="The Docent"></div>
    <p class="eyebrow">A companion to The Archivist</p>
    <h1>The Docent</h1>
    <p class="intro">Your private, portable gallery. Bring in a Docent file from The Archivist once; the complete portfolio remains on this device when disconnected.</p>
    <button class="primary" data-import>Bring in a gallery</button>
    <button class="secondary" data-dropbox>Connect Dropbox</button>
    <button class="secondary install-button" data-install hidden>Install The Docent</button>
    <p class="privacy">No account · no public portfolio · device-local storage</p>
  </main>${renderDock()}`;
  bindActions();
};

const workGrade = work => work.grade ?? work.rating ?? work.metadata?.grade ?? work.metadata?.rating ?? '';
const workQuotes = work => (Array.isArray(work.quotes) ? work.quotes : Array.isArray(work.metadata?.quotes) ? work.metadata.quotes : [])
  .filter(quote => quote?.showInBook !== false)
  .map(quote => typeof quote === 'string' ? { text: quote, attribution: '' } : quote)
  .filter(quote => String(quote?.text || quote?.quote || '').trim());
const epigraphMarkup = quote => `<button type="button" class="epigraph-link" data-quote-work="${escapeHtml(quote.work?.id || '')}" aria-label="Open ${escapeHtml(quote.work?.title || 'source work')}"><blockquote>“${escapeHtml(quote.text || quote.quote)}”</blockquote><figcaption><span></span>${escapeHtml(quote.attribution || gallery.profile?.name || 'The Artist')}<em>From ${escapeHtml(quote.work?.title || 'Untitled')}</em><small>The Archivist quote book</small></figcaption></button>`;
const shuffledQuotes = quotes => {
  const shuffled = [...quotes];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  if (shuffled.length > 1 && String(shuffled[0]?.text || shuffled[0]?.quote) === lastQuoteText) shuffled.push(shuffled.shift());
  return shuffled;
};

const homeShelfCard = (work, index, variant = '') => `<button class="home-shelf-card ${variant === 'rated' ? 'is-rated-card' : ''} ${workExternalUrl(work) ? 'is-linked-work' : ''}" data-work="${escapeHtml(work.id)}" style="--delay:${index * 28}ms">
  ${variant === 'rated' ? `<span class="home-score" aria-hidden="true">${escapeHtml(workGrade(work))}</span>` : ''}
  <span class="home-shelf-art">${workCardVisual(work)}${variant === 'rated' ? `<span class="home-type-ribbon">${escapeHtml(work.medium || work.type || 'Artwork')}</span>` : ''}</span>
  <span class="home-shelf-copy"><strong>${escapeHtml(work.title)}</strong><em>${escapeHtml(work.medium || work.type || 'Archive work')}</em></span>
</button>`;

const renderHome = works => {
  const updateTime = work => Date.parse(work.updatedAt || work.date || '') || 0;
  const gradeScore = work => {
    const grade = String(workGrade(work)).trim().toUpperCase();
    const numeric = Number.parseFloat(grade);
    if (Number.isFinite(numeric)) return numeric;
    const letter = grade.match(/^([ABCDF])([+-])?/);
    if (!letter) return -Infinity;
    return ({ A: 4, B: 3, C: 2, D: 1, F: 0 }[letter[1]] || 0) + (letter[2] === '+' ? .3 : letter[2] === '-' ? -.3 : 0);
  };
  const recent = [...works].sort((left, right) => updateTime(right) - updateTime(left) || works.indexOf(right) - works.indexOf(left)).slice(0, 12);
  const highestRated = works.filter(work => String(workGrade(work)).trim()).sort((left, right) => gradeScore(right) - gradeScore(left)).slice(0, 12);
  const latest = recent[0] || works[works.length - 1] || works[0];
  const publicQuotes = works.flatMap(work => workQuotes(work).map(quote => ({ ...quote, work })));
  const quoteSignature = publicQuotes.map(quote => `${quote.text || quote.quote}|${quote.attribution || ''}|${quote.work?.id || ''}`).join('\n');
  if (quoteQueueSignature !== quoteSignature || !quoteQueue.length) {
    quoteQueueSignature = quoteSignature;
    quoteQueue = shuffledQuotes(publicQuotes);
  }
  const featuredQuote = quoteQueue.shift();
  if (featuredQuote) lastQuoteText = String(featuredQuote.text || featuredQuote.quote);
  const shelves = [
    ['Recently updated', recent],
    ['Highest rated', highestRated, 'rated'],
    ['Images', works.filter(isImageWork)],
    ['Poetry', works.filter(isPoetryWork)],
    ['Music', works.filter(isMusicWork)],
    ['Video', works.filter(isVideoWork)],
    ['Writing', works.filter(work => !isPoetryWork(work) && (['writing', 'prose', 'essay', 'story', 'document'].includes(String(work.type || work.medium || '').toLowerCase()) || work.media?.mimeType === 'application/pdf' || work.mimeType === 'application/pdf'))]
  ].filter(([, shelfWorks]) => shelfWorks.length);
  app.innerHTML = `<div class="shell home-shell">
    ${renderTopbar()}
    ${featuredQuote ? `<figure class="home-epigraph" data-epigraph>${epigraphMarkup(featuredQuote)}</figure>` : ''}
    <section class="home-feature" aria-label="Latest addition">
      <div class="home-feature-media">${workCardVisual(latest)}</div>
      <div class="home-feature-shade"></div>
      <div class="home-feature-copy"><p class="eyebrow">Latest addition</p><h1>${escapeHtml(latest.title)}</h1><p>${escapeHtml(latest.description || latest.medium || latest.type || 'The newest work in this portable collection.')}</p><button data-work="${escapeHtml(latest.id)}">View work <span>→</span></button></div>
    </section>
    <main class="home-shelves" id="collection">
      ${shelves.map(([title, shelfWorks, variant]) => `<section class="home-shelf ${variant === 'rated' ? 'is-rated-shelf' : ''}"><header><h2>${escapeHtml(title)}</h2><span>${shelfWorks.length}</span></header><div class="home-shelf-track">${shelfWorks.map((work, index) => homeShelfCard(work, index, variant)).join('')}</div></section>`).join('')}
    </main>
    <section class="about-panel" id="about"><p class="eyebrow">About the collection</p><h2>${escapeHtml(gallery.profile?.name || 'The Artist')}</h2>${gallery.profile?.statement ? `<p>${escapeHtml(gallery.profile.statement)}</p>` : '<p>This portable collection was curated in The Archivist.</p>'}</section>
    <footer><span>${works.length} ${works.length === 1 ? 'work' : 'works'} on this device</span>${gallery.profile?.contact ? `<a href="mailto:${encodeURIComponent(gallery.profile.contact)}">Contact</a>` : ''}</footer>
    ${renderDock()}
  </div>`;
  bindActions();
  document.querySelector('[data-epigraph]')?.addEventListener('click', event => {
    const trigger = event.target.closest('[data-quote-work]');
    const sourceWork = works.find(work => String(work.id) === String(trigger?.dataset.quoteWork));
    if (sourceWork) renderWork(sourceWork);
  });
  clearInterval(quoteCycleTimer);
  if (publicQuotes.length > 1) quoteCycleTimer = setInterval(() => {
    const epigraph = document.querySelector('[data-epigraph]');
    if (!epigraph) return clearInterval(quoteCycleTimer);
    epigraph.classList.add('is-changing');
    setTimeout(() => {
      if (!quoteQueue.length) quoteQueue = shuffledQuotes(publicQuotes);
      const nextQuote = quoteQueue.shift();
      lastQuoteText = String(nextQuote.text || nextQuote.quote);
      epigraph.innerHTML = epigraphMarkup(nextQuote);
      epigraph.classList.remove('is-changing');
    }, 260);
  }, 9000);
};

const profileScore = key => {
  const values = (gallery?.works || []).map(work => Number.parseFloat(work[key] ?? work.metadata?.[key])).filter(Number.isFinite);
  return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : '—';
};

const profileSections = text => {
  const sections = [];
  let current = { title: 'Critical profile', paragraphs: [] };
  String(text || '').split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    if (/^#{1,3}\s+/.test(line) || /^\*\*.+\*\*$/.test(line)) {
      if (current.paragraphs.length) sections.push(current);
      current = { title: line.replace(/[#*]/g, '').trim(), paragraphs: [] };
    } else current.paragraphs.push(line.replace(/^[-*]\s*/, '').replace(/\*\*/g, ''));
  });
  if (current.paragraphs.length) sections.push(current);
  return sections;
};

const renderProfile = works => {
  const profile = gallery.profile || {};
  const media = [...works.reduce((map, work) => {
    const label = work.type || work.medium || 'Unclassified';
    map.set(label, (map.get(label) || 0) + 1);
    return map;
  }, new Map()).entries()].sort((left, right) => right[1] - left[1]);
  const tags = [...works.flatMap(work => work.tags || []).reduce((map, tag) => map.set(tag, (map.get(tag) || 0) + 1), new Map()).entries()].sort((left, right) => right[1] - left[1]).slice(0, 10);
  const sections = profileSections(profile.evaluation);
  const strongest = [...works].filter(work => String(workGrade(work)).trim()).sort((left, right) => Number.parseFloat(workGrade(right)) - Number.parseFloat(workGrade(left))).slice(0, 8);
  const maxMedium = Math.max(1, ...media.map(([, count]) => count));
  app.innerHTML = `<div class="shell profile-shell">
    ${renderTopbar()}
    <main class="profile-page">
      <header class="profile-hero">
        <div class="profile-portrait">${profile.portrait ? `<img src="${profile.portrait}" alt="Portrait of ${escapeHtml(profile.name || 'the artist')}">` : `<span>${escapeHtml(String(profile.name || 'A').charAt(0))}</span>`}</div>
        <div class="profile-intro"><p class="eyebrow">The artist behind the archive</p><h1>${escapeHtml(profile.name || 'The Artist')}</h1>${profile.location ? `<p class="profile-location">${escapeHtml(profile.location)}</p>` : ''}${profile.statement ? `<blockquote>${escapeHtml(profile.statement)}</blockquote>` : '<blockquote>An artistic identity assembled from the complete portable corpus.</blockquote>'}</div>
      </header>
      <section class="profile-scoreboard" aria-label="Corpus evaluation"><div><span>Works</span><strong>${works.length}</strong></div><div><span>Grade</span><strong>${profileScore('grade')}</strong></div><div><span>Media</span><strong>${media.length}</strong></div><div><span>Projects</span><strong>${new Set(works.flatMap(work => work.projects || [])).size}</strong></div></section>
      <section class="profile-practice"><div><p class="eyebrow">Multimodal practice</p><h2>A body of work without a single container.</h2></div><div class="profile-mediums">${media.map(([label, count]) => `<div><header><strong>${escapeHtml(label)}</strong><span>${count}</span></header><i style="--profile-bar:${Math.round((count / maxMedium) * 100)}%"></i></div>`).join('')}</div></section>
      ${sections.length ? `<section class="profile-critical"><header><p class="eyebrow">Corpus intelligence</p><h2>Critical profile</h2><p>${profile.evaluationUpdatedAt ? `Synthesized ${escapeHtml(new Date(profile.evaluationUpdatedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}` : `${works.length} works considered`}</p></header><div class="profile-essay">${sections.map(section => `<article><h3>${escapeHtml(section.title)}</h3>${section.paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('')}</article>`).join('')}</div></section>` : `<section class="profile-critical profile-awaiting"><p class="eyebrow">Corpus intelligence</p><h2>Awaiting the artist’s public corpus evaluation.</h2><p>Publish an Artistic Profile from Archivist to complete this page.</p></section>`}
      ${tags.length ? `<section class="profile-signals"><p class="eyebrow">Recurring constellations</p><div>${tags.map(([tag, count]) => `<span>${escapeHtml(tag)} <em>${count}</em></span>`).join('')}</div></section>` : ''}
      ${strongest.length ? `<section class="home-shelf profile-evidence"><header><h2>Evidence in the archive</h2><span>${strongest.length}</span></header><div class="home-shelf-track">${strongest.map((work, index) => homeShelfCard(work, index)).join('')}</div></section>` : ''}
      <footer><span>Artist profile · ${works.length} works</span>${profile.contact ? `<a href="mailto:${encodeURIComponent(profile.contact)}">Contact</a>` : ''}</footer>
    </main>${renderDock()}
  </div>`;
  bindActions();
};

const renderGallery = () => {
  clearInterval(quoteCycleTimer);
  detailExpanded = false;
  setCardViewLock(false);
  const works = gallery.works || [];
  if (!works.length) {
    renderEmpty();
    return;
  }
  if (activeType === 'All') {
    renderHome(works);
    return;
  }
  if (activeType === 'Profile') {
    renderProfile(works);
    return;
  }
  const categoryWorks = works.filter(work => matchesCategory(work, activeType));
  const categoryUpdateTime = work => Date.parse(work.updatedAt || work.date || '') || 0;
  const categoryLatest = [...categoryWorks].sort((left, right) => categoryUpdateTime(right) - categoryUpdateTime(left) || categoryWorks.indexOf(right) - categoryWorks.indexOf(left))[0] || categoryWorks[0] || works[0];
  const projects = ['All', ...new Set(categoryWorks.flatMap(work => work.projects || []))];
  const types = ['All', ...new Set(categoryWorks.map(work => work.type || work.medium).filter(Boolean))];
  const tags = ['All', ...new Set(categoryWorks.flatMap(work => work.tags || []))];
  const filteredWorks = currentCollectionWorks();
  const years = categoryWorks.map(work => String(work.date || '').slice(0, 4)).filter(year => /^\d{4}$/.test(year)).map(Number).sort();
  const activeFilters = [activeProject !== 'All' && activeProject, activeTag !== 'All' && `#${activeTag}`].filter(Boolean);
  app.innerHTML = `<div class="shell category-shell">
    ${renderTopbar()}
    <section class="home-feature category-feature" aria-label="Latest in ${escapeHtml(activeType)}">
      <div class="home-feature-media">${workCardVisual(categoryLatest)}</div>
      <div class="home-feature-shade"></div>
      <div class="home-feature-copy"><p class="eyebrow">Latest in ${escapeHtml(activeType)}</p><h1>${escapeHtml(categoryLatest.title)}</h1><p>${escapeHtml(categoryLatest.description || categoryLatest.medium || categoryLatest.type || `The newest work in ${activeType}.`)}</p><button data-work="${escapeHtml(categoryLatest.id)}">View work <span>→</span></button></div>
    </section>
    <section class="collection-tools" id="collection">
      <label class="search"><span>Search collection</span><input type="search" value="${escapeHtml(searchQuery)}" placeholder="Title, medium, year, project…" data-search></label>
      <details class="facet-drawer" ${activeFilters.length ? 'open' : ''}>
        <summary><span>Filter collection</span><em>${activeFilters.length ? escapeHtml(activeFilters.join(' · ')) : 'Project · Tags'}</em></summary>
        <details class="project-rolodex">
          <summary><span>Project</span><strong>${escapeHtml(activeProject === 'All' ? 'All projects' : activeProject)}</strong><em>${projects.length - 1}</em></summary>
          <div class="rolodex-stack">${projects.map((project, index) => `<button class="${project === activeProject ? 'is-active' : ''}" data-project="${escapeHtml(project)}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(project)}</strong><em>${project === 'All' ? categoryWorks.length : categoryWorks.filter(work => work.projects?.includes(project)).length}</em></button>`).join('')}</div>
        </details>
        <div class="facet-group"><label>Tags</label><div class="filter-row">${tags.map(tag => `<button class="filter-chip ${tag === activeTag ? 'is-active' : ''}" data-tag="${escapeHtml(tag)}">${tag === 'All' ? 'All' : `#${escapeHtml(tag)}`}</button>`).join('')}</div></div>
        ${activeFilters.length ? '<button class="clear-filters" data-clear-filters>Clear filters</button>' : ''}
      </details>
      <p class="result-count">${filteredWorks.length} of ${categoryWorks.length} ${categoryWorks.length === 1 ? 'work' : 'works'}</p>
    </section>
    <details class="stats-bar" id="stats">
      <summary><span>${activeType === 'All' ? 'Collection' : escapeHtml(activeType)} index</span><strong>${categoryWorks.length} works</strong><em>Expand statistics</em></summary>
      <div class="stats-grid">
        <div><strong>${categoryWorks.length}</strong><span>Total works</span></div>
        <div><strong>${types.length - 1}</strong><span>Artwork types</span></div>
        <div><strong>${projects.length - 1}</strong><span>Projects</span></div>
        <div><strong>${tags.length - 1}</strong><span>Tags</span></div>
        <div><strong>${years.length ? `${years[0]}–${years[years.length - 1]}` : '—'}</strong><span>Date range</span></div>
        <div><strong>${filteredWorks.length}</strong><span>Currently visible</span></div>
      </div>
    </details>
    <main class="work-grid">
      ${filteredWorks.map((work, index) => `<button class="work-card ${workExternalUrl(work) ? 'is-linked-work' : ''}" data-work="${escapeHtml(work.id)}" style="--delay:${index * 35}ms">
        <span class="image-wrap">${workCardVisual(work)}</span>
        <span class="work-meta"><strong>${escapeHtml(work.title)}</strong><span>${escapeHtml([workExternalUrl(work) ? 'Open source' : '', work.medium, formatDate(work.date)].filter(Boolean).join(' · '))}</span></span>
      </button>`).join('')}
      ${filteredWorks.length ? '' : '<div class="no-results"><strong>No works found</strong><span>Try another search or project.</span></div>'}
    </main>
    <section class="about-panel" id="about"><p class="eyebrow">About the collection</p><h2>${escapeHtml(gallery.profile?.name || 'The Artist')}</h2>${gallery.profile?.statement ? `<p>${escapeHtml(gallery.profile.statement)}</p>` : '<p>This portable collection was curated in The Archivist.</p>'}</section>
    <footer><span>${categoryWorks.length} ${categoryWorks.length === 1 ? 'work' : 'works'} in ${activeType === 'All' ? 'the collection' : escapeHtml(activeType)}</span>${gallery.profile?.contact ? `<a href="mailto:${encodeURIComponent(gallery.profile.contact)}">Contact</a>` : ''}</footer>
    ${renderDock()}
  </div>`;
  bindActions();
};

const renderWork = work => {
  setCardViewLock(true);
  activeDetailWorkId = String(work.id);
  const works = currentCollectionWorks();
  const detailTypes = new Set(works.map(candidate => candidate.type || candidate.medium).filter(Boolean));
  const detailProjects = new Set(works.flatMap(candidate => candidate.projects || []));
  const index = works.findIndex(candidate => String(candidate.id) === String(work.id));
  const previous = index > 0 ? works[index - 1] : works[works.length - 1];
  const next = index < works.length - 1 ? works[index + 1] : works[0];
  app.innerHTML = `<article class="work-view ${detailExpanded ? 'is-full-bleed' : ''}">
    ${renderTopbar()}
    <header class="detail-nav"><label class="detail-search"><input type="search" placeholder="Search this collection…" aria-label="Search this collection from card view" data-detail-search><span class="detail-search-results" data-detail-results hidden></span></label><span>${index + 1} / ${works.length}</span><div><button data-previous aria-label="Previous work">←</button><button data-next aria-label="Next work">→</button></div></header>
    <h1 class="detail-title">${escapeHtml(work.title)}</h1>
    <div class="work-stage" data-swipe-stage>
      <button class="detail-close" data-back aria-label="Close card and return to gallery">×</button>
      <div class="card-motion" data-card-motion><div class="detail-card ${detailSide === 'metadata' ? 'is-flipped' : ''}" data-detail-card>
        <section class="detail-face detail-front">${workDetailFront(work)}${workExternalUrl(work) ? `<a class="external-launch" href="${escapeHtml(sourceLaunchUrl(work))}">${escapeHtml(sourceLaunchLabel(work))}<span>↗</span></a>` : ''}</section>
        <section class="detail-face detail-back">
          <p class="eyebrow">${escapeHtml(work.projects?.join(' · ') || 'Selected work')}</p>
          <h1>${escapeHtml(work.title)}</h1>
          <dl>
            ${work.date ? `<div><dt>Date</dt><dd>${escapeHtml(formatDate(work.date))}</dd></div>` : ''}
            ${work.medium ? `<div><dt>Medium</dt><dd>${escapeHtml(work.medium)}</dd></div>` : ''}
            ${work.type ? `<div><dt>Artwork type</dt><dd>${escapeHtml(work.type)}</dd></div>` : ''}
            ${work.dimensions ? `<div><dt>Dimensions</dt><dd>${escapeHtml(work.dimensions)}</dd></div>` : ''}
            ${work.catalogId ? `<div><dt>Catalog</dt><dd>${escapeHtml(work.catalogId)}</dd></div>` : ''}
            ${workGrade(work) ? `<div><dt>Grade</dt><dd>${escapeHtml(workGrade(work))}</dd></div>` : ''}
            ${work.identity ? `<div><dt>Identity</dt><dd>${escapeHtml(work.identity)}</dd></div>` : ''}
            ${work.duration ? `<div><dt>Duration</dt><dd>${escapeHtml(work.duration)}</dd></div>` : ''}
            ${workExternalUrl(work) ? `<div><dt>Source</dt><dd><a class="metadata-source-link" href="${escapeHtml(sourceLaunchUrl(work))}">${escapeHtml(sourceLaunchLabel(work))} ↗</a></dd></div>` : ''}
            ${work.projects?.length ? `<div><dt>Project</dt><dd>${escapeHtml(work.projects.join(', '))}</dd></div>` : ''}
            ${work.tags?.length ? `<div><dt>Tags</dt><dd>${escapeHtml(work.tags.map(tag => `#${tag}`).join(' '))}</dd></div>` : ''}
          </dl>
          ${work.critique ? `<section class="critique-card"><span>Archivist critique</span><p>${escapeHtml(work.critique)}</p></section>` : ''}
          ${isPoetryWork(work) && work.text ? `<section class="transcription-card"><span>Transcription</span><p>${escapeHtml(work.text)}</p></section>` : ''}
          ${work.description ? `<p class="description">${escapeHtml(work.description)}</p>` : ''}
        </section>
      </div></div>
    </div>
    <div class="card-slider-wrap"><span>Next</span><div class="card-slider" role="slider" tabindex="0" aria-label="Pull left for next or right for previous" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="0" data-card-slider><span class="card-slider-track"><i data-slider-progress></i><b data-slider-thumb></b></span></div><span>Previous</span></div>
    <p class="swipe-hint">${workExternalUrl(work) ? 'Hold the preview to open its source app' : work.media?.mimeType === 'application/pdf' ? 'Hold to expand · swipe sideways to browse' : 'Tap the card to turn it over'}</p>
    ${renderDock()}
  </article>`;
  const stage = document.querySelector('[data-swipe-stage]');
  const cardMotion = document.querySelector('[data-card-motion]');
  const card = document.querySelector('[data-detail-card]');
  hydratePdfReader(work);
  const goToWork = (target, direction) => {
    if (!target || !cardMotion) return;
    cardMotion.style.transition = 'transform .2s ease, opacity .2s ease';
    cardMotion.style.transform = `translateX(${direction * 105}%)`;
    cardMotion.style.opacity = '0';
    setTimeout(() => { detailSide = 'image'; renderWork(target); }, 205);
  };
  const settleCard = nextSide => {
    detailSide = nextSide;
    const targetAngle = nextSide === 'metadata' ? 180 : 0;
    card.style.transition = 'transform .58s cubic-bezier(.2,.75,.2,1)';
    card.style.transform = `rotateY(${targetAngle}deg)`;
    document.querySelectorAll('[data-side]').forEach(button => button.classList.toggle('is-active', button.dataset.side === nextSide));
    setTimeout(() => {
      card.classList.toggle('is-flipped', nextSide === 'metadata');
      card.style.transition = '';
      card.style.transform = '';
    }, 590);
  };
  let pointerStart = null;
  let longPressTimer = null;
  const cancelLongPress = () => { clearTimeout(longPressTimer); longPressTimer = null; };
  const enterFullBleed = pointerId => {
    if (!pointerStart || pointerStart.id !== pointerId || detailExpanded) return;
    pointerStart.longPressed = true;
    if (workExternalUrl(work)) {
      pointerStart.openExternal = true;
      navigator.vibrate?.(18);
      return;
    }
    detailExpanded = true;
    document.querySelector('.work-view')?.classList.add('is-full-bleed');
    document.querySelector('[data-back]')?.setAttribute('aria-label', 'Exit full-screen card');
    navigator.vibrate?.(18);
  };
  stage?.addEventListener('pointerdown', event => {
    if (event.target.closest('audio,video,iframe,button,input,a')) return;
    pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId, time: performance.now(), dx: 0, longPressed: false, openExternal: false };
    cancelLongPress();
    longPressTimer = setTimeout(() => enterFullBleed(event.pointerId), 560);
    cardMotion.style.transition = 'none';
    stage.setPointerCapture?.(event.pointerId);
  });
  stage?.addEventListener('pointermove', event => {
    if (!pointerStart || event.pointerId !== pointerStart.id) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    pointerStart.dx = dx;
    if (Math.hypot(dx, dy) > 9) cancelLongPress();
    if (Math.abs(dx) > Math.abs(dy) * .7) {
      event.preventDefault();
      cardMotion.style.transform = `translateX(${Math.max(-140, Math.min(140, dx))}px)`;
    }
  });
  stage?.addEventListener('pointerup', event => {
    if (!pointerStart || event.pointerId !== pointerStart.id) return;
    cancelLongPress();
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    const velocity = Math.abs(dx) / Math.max(1, performance.now() - pointerStart.time);
    const longPressed = pointerStart.longPressed;
    const openExternal = pointerStart.openExternal;
    pointerStart = null;
    if (openExternal) { cardMotion.style.transition = ''; cardMotion.style.transform = ''; openLinkedWork(work); return; }
    if (longPressed) { cardMotion.style.transition = ''; cardMotion.style.transform = ''; return; }
    if ((Math.abs(dx) > 38 || velocity > .28) && Math.abs(dx) > Math.abs(dy) * .7) {
      goToWork(dx < 0 ? next : previous, dx < 0 ? -1 : 1);
      return;
    }
    cardMotion.style.transition = 'transform .24s cubic-bezier(.2,.8,.2,1)';
    cardMotion.style.transform = '';
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) settleCard(detailSide === 'image' ? 'metadata' : 'image');
  });
  stage?.addEventListener('pointercancel', () => { cancelLongPress(); pointerStart = null; cardMotion.style.transition = ''; cardMotion.style.transform = ''; });
  stage?.addEventListener('contextmenu', event => event.preventDefault());
  const slider = document.querySelector('[data-card-slider]');
  const sliderThumb = document.querySelector('[data-slider-thumb]');
  const sliderProgress = document.querySelector('[data-slider-progress]');
  let sliderDrag = null;
  const paintSlider = dx => {
    const maximum = Math.max(48, slider.clientWidth / 2 - 14);
    const position = Math.max(-maximum, Math.min(maximum, dx));
    const percent = Math.round(position / maximum * 100);
    sliderThumb.style.transform = `translateX(${position}px)`;
    sliderProgress.style.width = `${Math.abs(position)}px`;
    sliderProgress.style.transform = `translateX(${position < 0 ? -Math.abs(position) : 0}px)`;
    slider.setAttribute('aria-valuenow', String(percent));
    cardMotion.style.transition = 'none';
    cardMotion.style.transform = `translateX(${position * .38}px)`;
    return { position, percent };
  };
  const resetSlider = () => {
    slider.classList.remove('is-dragging');
    sliderThumb.style.transform = '';
    sliderProgress.style.width = '';
    sliderProgress.style.transform = '';
    slider.setAttribute('aria-valuenow', '0');
    cardMotion.style.transition = 'transform .24s cubic-bezier(.2,.8,.2,1)';
    cardMotion.style.transform = '';
  };
  slider?.addEventListener('pointerdown', event => {
    sliderDrag = { id: event.pointerId, x: event.clientX, time: performance.now(), percent: 0 };
    slider.classList.add('is-dragging');
    slider.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  slider?.addEventListener('pointermove', event => {
    if (!sliderDrag || event.pointerId !== sliderDrag.id) return;
    sliderDrag.percent = paintSlider(event.clientX - sliderDrag.x).percent;
    event.preventDefault();
  });
  const finishSlider = event => {
    if (!sliderDrag || event.pointerId !== sliderDrag.id) return;
    const elapsed = Math.max(1, performance.now() - sliderDrag.time);
    const dx = event.clientX - sliderDrag.x;
    const velocity = Math.abs(dx) / elapsed;
    const percent = sliderDrag.percent;
    const direction = percent || dx;
    sliderDrag = null;
    if (Math.abs(percent) >= 38 || velocity > .32) {
      sliderThumb.style.transform = `translateX(${direction < 0 ? '-120px' : '120px'})`;
      goToWork(direction < 0 ? next : previous, direction < 0 ? -1 : 1);
    } else resetSlider();
    event.preventDefault();
  };
  slider?.addEventListener('pointerup', finishSlider);
  slider?.addEventListener('pointercancel', event => { if (sliderDrag?.id === event.pointerId) { sliderDrag = null; resetSlider(); } });
  slider?.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); goToWork(previous, -1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); goToWork(next, 1); }
  });
  const detailSearch = document.querySelector('[data-detail-search]');
  const detailResults = document.querySelector('[data-detail-results]');
  const detailMatches = value => {
    const query = value.trim().toLowerCase();
    if (!query) return [];
    return works.filter(candidate => [candidate.title, candidate.type, candidate.medium, candidate.catalogId, candidate.critique, ...(candidate.projects || []), ...(candidate.tags || [])].join(' ').toLowerCase().includes(query)).slice(0, 8);
  };
  detailSearch?.addEventListener('input', event => {
    const matches = detailMatches(event.target.value);
    detailResults.innerHTML = matches.map(candidate => `<button data-detail-result="${escapeHtml(candidate.id)}"><strong>${escapeHtml(candidate.title)}</strong><span>${escapeHtml(candidate.type || candidate.medium || 'Work')}</span></button>`).join('');
    detailResults.hidden = !matches.length;
    detailResults.querySelectorAll('[data-detail-result]').forEach(button => button.addEventListener('click', () => {
      const match = works.find(candidate => String(candidate.id) === button.dataset.detailResult);
      if (match) { if (!openLinkedWork(match)) { detailSide = 'image'; renderWork(match); } }
    }));
  });
  detailSearch?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      const match = detailMatches(event.currentTarget.value)[0];
      if (match) { event.preventDefault(); if (!openLinkedWork(match)) { detailSide = 'image'; renderWork(match); } }
    }
    if (event.key === 'Escape') detailResults.hidden = true;
  });
  document.querySelector('[data-previous]')?.addEventListener('click', () => goToWork(previous, 1));
  document.querySelector('[data-next]')?.addEventListener('click', () => goToWork(next, -1));
  bindActions();
};

const bindActions = () => {
  document.querySelectorAll('[data-import]').forEach(button => button.addEventListener('click', () => packageInput.click()));
  document.querySelectorAll('[data-dropbox]').forEach(button => button.addEventListener('click', () => syncDropbox().catch(error => alert(error.message))));
  document.querySelectorAll('[data-work]').forEach(button => button.addEventListener('click', () => {
    const work = gallery.works.find(candidate => String(candidate.id) === button.dataset.work);
    if (work) {
      galleryScrollY = window.scrollY; detailExpanded = false; detailSide = 'image'; renderWork(work);
    }
  }));
  document.querySelector('[data-back]')?.addEventListener('click', () => {
    if (detailExpanded) {
      detailExpanded = false;
      document.querySelector('.work-view')?.classList.remove('is-full-bleed');
      document.querySelector('[data-back]')?.setAttribute('aria-label', 'Close card and return to gallery');
      return;
    }
    renderGallery();
    requestAnimationFrame(() => window.scrollTo({ top: galleryScrollY, behavior: 'instant' }));
  });
  const openGalleryTarget = (selector, { focus = false, open = false } = {}) => {
    if (!document.querySelector(selector)) renderGallery();
    setTimeout(() => {
      const target = document.querySelector(selector);
      if (open && target) target.open = true;
      target?.scrollIntoView({ behavior: 'smooth', block: selector === '#stats' ? 'center' : 'start' });
      if (focus) target?.focus();
    }, 0);
  };
  document.querySelectorAll('[data-collection]').forEach(button => button.addEventListener('click', () => openGalleryTarget('#collection')));
  document.querySelectorAll('[data-about]').forEach(button => button.addEventListener('click', () => openGalleryTarget('#about')));
  document.querySelectorAll('[data-home]').forEach(button => button.addEventListener('click', () => { if (gallery) { activeType = 'All'; activeProject = 'All'; activeTag = 'All'; searchQuery = ''; renderGallery(); } window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  document.querySelectorAll('[data-search-nav]').forEach(button => button.addEventListener('click', () => {
    openGalleryTarget('[data-search]', { focus: true });
  }));
  document.querySelectorAll('[data-stats]').forEach(button => button.addEventListener('click', () => {
    const modal = document.querySelector('[data-stats-modal]');
    modal?.classList.add('is-open');
    modal?.setAttribute('aria-hidden', 'false');
  }));
  const statsModal = document.querySelector('[data-stats-modal]');
  const closeStats = () => { statsModal?.classList.remove('is-open'); statsModal?.setAttribute('aria-hidden', 'true'); };
  statsModal?.addEventListener('click', event => { if (event.target === statsModal) closeStats(); });
  document.querySelector('[data-stats-close]')?.addEventListener('click', closeStats);
  const menu = document.querySelector('.art-menu');
  const menuHandle = document.querySelector('[data-art-menu-toggle]');
  if (menu && menuHandle) {
    let menuStartX = null;
    let menuPointerId = null;
    let menuTranslate = artMenuOpen ? 0 : menu.offsetWidth;
    menuHandle.addEventListener('pointerdown', event => {
      menuStartX = event.clientX;
      menuPointerId = event.pointerId;
      menuTranslate = artMenuOpen ? 0 : menu.offsetWidth;
      menu.style.transition = 'none';
      menuHandle.setPointerCapture?.(event.pointerId);
    });
    menuHandle.addEventListener('pointermove', event => {
      if (menuStartX === null || event.pointerId !== menuPointerId) return;
      menuTranslate = Math.max(0, Math.min(menu.offsetWidth, (artMenuOpen ? 0 : menu.offsetWidth) + event.clientX - menuStartX));
      menu.style.transform = `translateX(${menuTranslate}px)`;
    });
    const settleMenu = event => {
      if (menuStartX === null || event.pointerId !== menuPointerId) return;
      const moved = Math.abs(event.clientX - menuStartX);
      artMenuOpen = moved < 8 ? !artMenuOpen : menuTranslate < menu.offsetWidth / 2;
      menuStartX = null;
      menuPointerId = null;
      menu.style.transition = '';
      menu.style.transform = '';
      menu.classList.toggle('is-open', artMenuOpen);
      document.querySelector('.art-menu-scrim')?.classList.toggle('is-open', artMenuOpen);
    };
    menuHandle.addEventListener('pointerup', settleMenu);
    menuHandle.addEventListener('pointercancel', event => { menuTranslate = artMenuOpen ? 0 : menu.offsetWidth; settleMenu(event); });
  }
  document.querySelector('[data-art-menu-dismiss]')?.addEventListener('click', () => {
    artMenuOpen = false;
    menu?.classList.remove('is-open');
    document.querySelector('.art-menu-scrim')?.classList.remove('is-open');
  });
  document.querySelectorAll('[data-menu-category]').forEach(button => button.addEventListener('click', () => {
    activeType = button.dataset.menuCategory;
    activeProject = 'All';
    activeTag = 'All';
    searchQuery = '';
    artMenuOpen = false;
    renderGallery();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  document.querySelector('[data-search]')?.addEventListener('input', event => {
    searchQuery = event.target.value;
    const cursor = searchQuery.length;
    renderGallery();
    const input = document.querySelector('[data-search]');
    input?.focus();
    input?.setSelectionRange(cursor, cursor);
  });
  document.querySelectorAll('[data-project]').forEach(button => button.addEventListener('click', () => { activeProject = button.dataset.project; renderGallery(); }));
  document.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => { activeType = button.dataset.type; renderGallery(); }));
  document.querySelectorAll('[data-tag]').forEach(button => button.addEventListener('click', () => { activeTag = button.dataset.tag; renderGallery(); }));
  document.querySelector('[data-clear-filters]')?.addEventListener('click', () => { activeProject = 'All'; activeTag = 'All'; searchQuery = ''; renderGallery(); });
  const installButton = document.querySelector('[data-install]');
  if (installButton && deferredInstall) {
    installButton.hidden = false;
    installButton.addEventListener('click', async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; installButton.hidden = true; });
  }
};

packageInput.addEventListener('change', async () => {
  const file = packageInput.files?.[0];
  packageInput.value = '';
  if (!file) return;
  try {
    const value = JSON.parse(await file.text());
    if (!validPackage(value)) throw new Error('Not a Docent gallery file.');
    await storeGallery(value);
    renderGallery();
  } catch (error) {
    alert(error.message || 'The gallery could not be opened.');
  }
});

window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; bindActions(); });
window.addEventListener('online', () => document.body.classList.remove('is-offline'));
window.addEventListener('offline', () => document.body.classList.add('is-offline'));
window.addEventListener('resize', updateVisualViewport);
window.visualViewport?.addEventListener('resize', updateVisualViewport);
window.visualViewport?.addEventListener('scroll', updateVisualViewport);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=44', { updateViaCache: 'none' }).then(registration => registration.update()).catch(() => {});

const oauth = new URLSearchParams(location.search);
const oauthCode = oauth.get('code');
const oauthState = oauth.get('state');
const connectFromQr = oauth.get('connect') === 'dropbox';
if (oauthCode) {
  try {
    if (oauthState !== sessionStorage.getItem('curator-dropbox-state')) throw new Error('Dropbox rejected the connection state.');
    await exchangeDropboxCode(oauthCode);
    history.replaceState({}, '', location.pathname);
  } catch (error) { alert(error.message); }
}

gallery = await readStoredGallery();
gallery ? renderGallery() : renderEmpty();
if (connectFromQr) {
  history.replaceState({}, '', location.pathname);
  const existingDropbox = await readValue(DROPBOX_TOKEN);
  if (existingDropbox) syncDropbox().catch(error => alert(error.message));
  else connectDropbox().catch(error => alert(error.message));
} else if (navigator.onLine) syncDropbox({ quiet: true }).catch(() => {});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && navigator.onLine) syncDropbox({ quiet: true }).catch(() => {});
});
setInterval(() => {
  if (document.visibilityState === 'visible' && navigator.onLine) syncDropbox({ quiet: true }).catch(() => {});
}, 120000);
