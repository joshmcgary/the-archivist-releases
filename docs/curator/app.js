const DB_NAME = 'the-curator';
const STORE = 'gallery';
// Do not hydrate the pre-G7 monolithic gallery: it may contain full PDFs and
// video blobs large enough to terminate mobile Safari before Dropbox can sync.
// The Dropbox token remains in the same database, so the compact gallery can
// be fetched again without asking the user to reconnect.
const CURRENT = 'current-g10';
const DROPBOX_TOKEN = 'dropbox-token';
const DROPBOX_APP_KEY = 'q0q03vfz682exrg';
const DROPBOX_PATH = '/The_Docent_Gallery_Latest.json';
const LEGACY_DROPBOX_PATH = '/The_Curator_Gallery_Latest.json';
const DROPBOX_MANIFEST_PATH = '/The_Docent/manifest.json';
const DOCENT_MANIFEST = 'docent-manifest';
const DOCENT_SHARD_PREFIX = 'docent-shard:';
const PUBLIC_CORPUS_ENDPOINT = '/api/docent';
const DOCENT_BUILD = 'ARCHIVE-87';
const PUBLIC_SITE_URLS = {
  home: 'https://joshmcgary.com/',
  Images: 'https://art.joshmcgary.com/',
  Thoughts: 'https://thoughts.joshmcgary.com/',
  Video: 'https://video.joshmcgary.com/',
  Music: 'https://audio.joshmcgary.com/'
};
const MAX_DOCENT_PACKAGE_BYTES = 80 * 1024 * 1024;

const app = document.querySelector('#app');
const packageInput = document.querySelector('#package-input');
let gallery = null;
let deferredInstall = null;
let searchQuery = '';
let searchRenderTimer = null;
let activeProject = 'All';
const entranceType = ({ hostname, search }) => {
  const requested = new URLSearchParams(search).get('entrance');
  if (requested) return ({ poetry: 'Poetry', art: 'Images', music: 'Music', thoughts: 'Thoughts' })[requested.toLowerCase()] || 'All';
  if (hostname.startsWith('poetry.')) return 'Poetry';
  if (hostname.startsWith('art.')) return 'Images';
  if (hostname.startsWith('music.')) return 'Music';
  if (hostname.startsWith('thoughts.')) return 'Thoughts';
  return 'All';
};
let activeType = entranceType(location);
let activeTag = 'All';
let activePublicAge = 'All';
let activeSubject = 'All';
let activeYear = 'All';
let activePublicCollection = '';
let detailSide = 'image';
let artMenuOpen = false;
let galleryScrollY = 0;
let detailExpanded = false;
let quoteCycleTimer = null;
let artHeroCycleTimer = null;
let homePortalTimers = [];
let quoteQueue = [];
let quoteQueueSignature = '';
let lastQuoteText = '';
let searchPromptTimer = null;
let artTitleFontIndex = 0;

const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const quoteLetterMarkup = value => `“${String(value || '').toUpperCase()}”`.split(/(\s+)/).map(token => /\s+/.test(token)
  ? token
  : `<span class="quote-word">${Array.from(token).map(character => `<span class="quote-letter" style="--letter-delay:${(Math.random() * .45).toFixed(2)}s;--letter-x:${((Math.random() - .5) * 3).toFixed(1)}px;--letter-y:${((Math.random() - .5) * 3).toFixed(1)}px;--letter-blur:${(.5 + Math.random() * .8).toFixed(1)}px">${escapeHtml(character)}</span>`).join('')}</span>`).join('');
window.addEventListener('error', event => { if (!app.children.length) app.innerHTML = `<main class="empty"><p class="eyebrow">Preview error</p><h1>Unable to open the archive</h1><p class="intro">${escapeHtml(event.message)}</p></main>`; });
window.addEventListener('unhandledrejection', event => { if (!app.children.length) app.innerHTML = `<main class="empty"><p class="eyebrow">Preview error</p><h1>Unable to open the archive</h1><p class="intro">${escapeHtml(event.reason?.message || event.reason)}</p></main>`; });
const updateVisualViewport = () => {
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--docent-viewport-height', `${Math.round(height)}px`);
};
updateVisualViewport();
const validPackage = value => Boolean(value && ['the-archivist.docent-gallery', 'the-archivist.curator-gallery', 'the-archivist.gallery'].includes(value.schema) && value.schemaVersion === 1 && Array.isArray(value.works));
const validManifest = value => Boolean(value?.schema === 'the-archivist.docent-manifest' && value.schemaVersion === 1 && Array.isArray(value.shards));
const validShard = value => Boolean(value?.schema === 'the-archivist.docent-shard' && value.schemaVersion === 1 && Array.isArray(value.works));
const publicShardCache = new Map();
const hasMediaFamily = (work, families) => [work.type, work.medium].some(value => families.includes(String(value || '').toLowerCase()));
const isImageWork = work => hasMediaFamily(work, ['drawing', 'image', 'photography', 'painting', 'illustration', 'sculpture']);
const isMusicWork = work => hasMediaFamily(work, ['music', 'audio', 'song', 'sound', 'album', 'recording']) || String(work.mimeType || '').startsWith('audio/');
const isVideoWork = work => hasMediaFamily(work, ['video', 'film', 'animation', 'motion']) || String(work.mimeType || '').startsWith('video/');
const isArtWork = work => isImageWork(work) || ['visual', 'digital art', 'graphic design', 'panel art', 'comic', 'software'].includes(String(work.type || work.medium || '').toLowerCase());
const isVisualWork = work => isArtWork(work) || isVideoWork(work);
const isPoetryWork = work => ['poetry', 'poem'].includes(String(work.type || work.medium || '').toLowerCase());
const workSubjects = work => Array.isArray(work.subjects) ? work.subjects.filter(Boolean) : [];
const workAge = work => {
  const explicit = work.chronology?.age ?? work.age;
  if (Number.isFinite(Number(explicit))) return String(Math.trunc(Number(explicit)));
  const catalogAge = String(work.catalogId || '').match(/^(\d{1,3})(?:\.|$)/)?.[1];
  return catalogAge || '';
};
const publicSearchCache = new WeakMap();
const PUBLIC_SEARCH_OMIT = new Set(['src', 'data', 'blob', 'bytes', 'image', 'imagedata', 'sourceartworkdata', 'thumbnail', 'poster', 'grade', 'rating', 'proficiency', 'expertise', 'cleverness', 'greatness']);
const ART_DISPLAY_FONTS = [
  '"Arial Black", Impact, sans-serif',
  '"Snell Roundhand", "Brush Script MT", cursive',
  '"American Typewriter", Rockwell, serif',
  'Papyrus, fantasy',
  'Chalkduster, "Marker Felt", fantasy',
  'Didot, "Bodoni 72", serif',
  '"Courier New", Courier, monospace',
  'Futura, "Avenir Next Condensed", sans-serif',
  'Copperplate, "Copperplate Gothic Light", serif',
  'Zapfino, "Apple Chancery", cursive'
];
const publicSearchText = work => {
  if (publicSearchCache.has(work)) return publicSearchCache.get(work);
  const values = [];
  const visit = (value, key = '') => {
    if (PUBLIC_SEARCH_OMIT.has(String(key).toLowerCase()) || value == null) return;
    if (Array.isArray(value)) return value.forEach(item => visit(item, key));
    if (typeof value === 'object') return Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values.push(String(value));
  };
  visit(work);
  const text = values.join(' ').toLocaleLowerCase().replace(/[-_./]+/g, ' ').replace(/\s+/g, ' ');
  publicSearchCache.set(work, text);
  return text;
};
const matchesPublicSearch = (work, query) => {
  const terms = String(query || '').toLocaleLowerCase().replace(/[-_./]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = publicSearchText(work);
  return terms.every(term => haystack.includes(term));
};
const isTheologyWork = work => {
  const labels = [...workSubjects(work), work.type, work.medium, ...(work.projects || []), ...(work.collections || []), ...(work.tags || [])]
    .map(value => String(value || '').toLowerCase()).join(' ');
  return /theolog|scriptur|bible|sermon|epistle|homilet|devotion|church|gospel|chapel/.test(labels);
};
const isWritingWork = work => {
  const labels = [work.type, work.medium, ...(work.projects || []), ...(work.collections || []), ...(work.tags || [])]
    .map(value => String(value || '').toLowerCase());
  return labels.some(label => ['writing', 'prose', 'essay', 'story', 'document', 'theology', 'commentary', 'bible thoughts'].includes(label));
};
const BIBLE_BOOKS = ['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth','1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon','Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation'];
const bibleBookOrder = name => {
  const index = BIBLE_BOOKS.findIndex(book => book.toLowerCase() === String(name || '').toLowerCase());
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
};
const matchesCategory = (work, category) => category === 'All'
  || (category === 'Images' && isArtWork(work))
  || (category === 'Music' && isMusicWork(work))
  || (category === 'Video' && isVideoWork(work))
  || (category === 'Theology' && isTheologyWork(work))
  || (category === 'Writing' && isWritingWork(work) && !isPoetryWork(work))
  || (category === 'Thoughts' && !isPoetryWork(work) && (isWritingWork(work) || isTheologyWork(work)))
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
const youtubeVideoId = work => String(workExternalUrl(work)).match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?/\s]{11})/i)?.[1] || '';
const workCardVisual = (work, { eager = false } = {}) => {
  const source = work.image || (String(work.media?.mimeType || '').startsWith('image/') ? workMediaSource(work) : '');
  const imageLoading = eager ? 'eager' : 'lazy';
  const isPdf = work.media?.mimeType === 'application/pdf' || work.mimeType === 'application/pdf';
  if (isPdf && source) return `<img src="${source}" alt="Cover of ${escapeHtml(work.title)}" loading="${imageLoading}">`;
  if (isPdf && workMediaSource(work)) return `<span class="pdf-cover-preview" data-pdf-cover="${escapeHtml(work.id)}"><span>Rendering cover…</span></span>`;
  if (source && isVideoWork(work)) return `<img src="${source}" alt="${escapeHtml(work.title)}" loading="${imageLoading}">`;
  const hasProseFront = Boolean(work.text) && isWritingWork(work) && !isVideoWork(work);
  if (hasProseFront) {
    const quote = workQuotes(work)[0];
    const excerpt = String(quote?.text || quote?.quote || work.text).replace(/\s+/g, ' ').trim().slice(0, 240);
    return `<span class="media-placeholder media-writing"><em>“${escapeHtml(excerpt)}”</em><small>${escapeHtml(work.title || 'Writing')}</small></span>`;
  }
  if (source) return `<img src="${source}" alt="${escapeHtml(work.title)}" loading="${imageLoading}">`;
  const kind = isMusicWork(work) ? 'Music' : isVideoWork(work) ? 'Video' : (work.type || work.medium || 'Archive');
  const excerpt = work.text || work.description || work.critique || '';
  return `<span class="media-placeholder media-${escapeHtml(kind.toLowerCase())}"><strong>${escapeHtml(kind)}</strong>${excerpt ? `<em>${escapeHtml(excerpt.slice(0, 180))}</em>` : '<em>Open the card to view</em>'}</span>`;
};
const artHeroMarkup = work => workCardVisual(work, { eager: true });
const workDetailFront = work => {
  const media = workMediaSource(work);
  const youtubeId = youtubeVideoId(work);
  if (work.media?.mimeType === 'application/pdf' && media) return `<div class="pdf-reader" data-pdf-reader><div class="pdf-reader-toolbar"><span data-pdf-status>Preparing PDF…</span><button data-open-pdf>Open in PDF app ↗</button></div><div class="pdf-pages" data-pdf-pages></div></div>`;
  if (isVideoWork(work) && media) return `<video src="${media}" controls playsinline ${work.image ? `poster="${work.image}"` : ''}></video>`;
  if (isVideoWork(work) && youtubeId) return `<iframe class="youtube-player" src="https://www.youtube-nocookie.com/embed/${youtubeId}?playsinline=1" title="${escapeHtml(work.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  if (isMusicWork(work) && media) return `<div class="audio-front">${work.image ? `<img src="${work.image}" alt="${escapeHtml(work.title)}">` : '<span class="audio-mark">♪</span>'}<h2>${escapeHtml(work.title)}</h2><audio src="${media}" controls></audio></div>`;
  const image = work.image || (String(work.media?.mimeType || '').startsWith('image/') ? media : '');
  const hasProseFront = Boolean(work.text) && isWritingWork(work) && !isVideoWork(work);
  if (hasProseFront) {
    return `<div class="text-front writing-front"><h2>${escapeHtml(work.title)}</h2>${work.identity ? `<p class="writing-byline">By ${escapeHtml(work.identity)}</p>` : ''}<p>${escapeHtml(work.text)}</p></div>`;
  }
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

const hydratePdfCardCovers = async () => {
  const targets = [...document.querySelectorAll('[data-pdf-cover]')];
  if (!targets.length) return;
  try {
    const pdfjs = await import('./vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
    const grouped = targets.reduce((map, target) => {
      const key = target.dataset.pdfCover;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(target);
      return map;
    }, new Map());
    await Promise.all([...grouped.entries()].map(async ([workId, workTargets]) => {
      const work = gallery?.works?.find(candidate => String(candidate.id) === workId);
      if (!work?.media?.src || !workTargets.some(target => target.isConnected)) return;
      const pdf = await pdfjs.getDocument({ data: dataUrlBytes(work.media.src) }).promise;
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const cssWidth = Math.max(180, workTargets[0]?.clientWidth || 240);
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * pixelRatio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.setAttribute('aria-label', `Cover of ${work.title}`);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const cover = canvas.toDataURL('image/jpeg', .88);
      workTargets.forEach(target => {
        if (!target.isConnected) return;
        const image = new Image();
        image.src = cover;
        image.alt = `Cover of ${work.title}`;
        target.replaceChildren(image);
      });
      pdf.destroy();
    }));
  } catch (error) {
    console.warn('Docent could not render PDF card covers.', error);
  }
};

const currentCollectionWorks = () => {
  const query = searchQuery.trim().toLowerCase();
  return (gallery?.works || []).filter(work => {
    if (!matchesCategory(work, activeType)) return false;
    if (activeProject !== 'All' && !work.projects?.includes(activeProject)) return false;
    if (activeTag !== 'All' && !work.tags?.includes(activeTag)) return false;
    if (activeSubject !== 'All' && !workSubjects(work).includes(activeSubject)) return false;
    if (activeYear !== 'All' && String(work.date || work.addedAt || '').slice(0, 4) !== activeYear) return false;
    if (activePublicAge !== 'All' && workAge(work) !== activePublicAge) return false;
    return matchesPublicSearch(work, query);
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

const downloadDropboxJson = async (accessToken, path) => {
  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Arg': JSON.stringify({ path }) }
  });
  if (response.status === 409) return null;
  if (!response.ok) throw new Error('The Docent could not download its Dropbox update.');
  return response.json();
};

const syncIncrementalDropbox = async accessToken => {
  const manifest = await downloadDropboxJson(accessToken, DROPBOX_MANIFEST_PATH);
  if (!manifest) return false;
  if (!validManifest(manifest)) throw new Error('Dropbox returned an invalid Docent manifest.');
  const storedManifest = await readValue(DOCENT_MANIFEST);
  const storedById = new Map((storedManifest?.shards || []).map(shard => [shard.id, shard]));
  const shards = [];
  for (const descriptor of manifest.shards) {
    let shard = storedById.get(descriptor.id)?.fingerprint === descriptor.fingerprint
      ? await readValue(`${DOCENT_SHARD_PREFIX}${descriptor.id}`) : null;
    if (!validShard(shard) || shard.fingerprint !== descriptor.fingerprint) {
      shard = await downloadDropboxJson(accessToken, descriptor.path);
      if (!validShard(shard) || shard.fingerprint !== descriptor.fingerprint) throw new Error(`Docent segment ${descriptor.id} is incomplete.`);
      await storeValue(`${DOCENT_SHARD_PREFIX}${descriptor.id}`, shard);
    }
    shards.push(shard);
  }
  const works = shards.flatMap(shard => shard.works).sort((left, right) => (left.order || 0) - (right.order || 0));
  const value = { ...manifest, schema: 'the-archivist.docent-gallery', schemaVersion: 1, works };
  await storeValue(DOCENT_MANIFEST, manifest);
  await storeGallery(value);
  renderGallery();
  return true;
};

const syncDropbox = async ({ quiet = false } = {}) => {
  const accessToken = await getDropboxAccessToken();
  if (!accessToken) {
    if (!quiet) await connectDropbox();
    return false;
  }
  if (await syncIncrementalDropbox(accessToken)) return true;
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
  const dropboxMetadata = (() => {
    try { return JSON.parse(response.headers.get('Dropbox-API-Result') || '{}'); } catch { return {}; }
  })();
  const payloadBytes = Number(response.headers.get('Content-Length')) || Number(dropboxMetadata.size) || 0;
  if (payloadBytes > MAX_DOCENT_PACKAGE_BYTES) {
    await response.body?.cancel?.();
    if (!quiet) alert('This gallery uses the retired oversized format. Open the updated Archivist once to publish its compact replacement.');
    return false;
  }
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
  return `<header class="archive-header">
    <a class="archive-wordmark" href="${PUBLIC_SITE_URLS.home}" aria-label="Josh McGary dot com — return home"><strong><span>Josh</span><span>McGary.com</span></strong></a>
    <nav aria-label="Archive sections">
      <a class="${activeType === 'Images' ? 'is-active' : ''}" href="${PUBLIC_SITE_URLS.Images}">Art</a>
      <a class="${activeType === 'Video' ? 'is-active' : ''}" href="${PUBLIC_SITE_URLS.Video}">Video</a>
      <a class="${activeType === 'Thoughts' ? 'is-active' : ''}" href="${PUBLIC_SITE_URLS.Thoughts}">Thoughts</a>
      <a class="${activeType === 'Music' ? 'is-active' : ''}" href="${PUBLIC_SITE_URLS.Music}">Audio</a>
    </nav>
  </header>`;
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
    chapel: '<svg viewBox="0 0 24 24"><path d="M12 2v6m-3-3h6M5 21V10l7-4 7 4v11M9 21v-7h6v7"/></svg>',
    quotes: '<svg viewBox="0 0 24 24"><path d="M5 6h6v6H7v6H3v-8a4 4 0 0 1 2-4Zm10 0h6v6h-4v6h-4v-8a4 4 0 0 1 2-4Z"/></svg>',
    profile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>'
  };
  const categories = [['All', 'Home', 'home'], ['Images', 'The Gallery', 'images'], ['Poetry', 'The Poetry Room', 'anthology'], ['Thoughts', 'The Thoughts Archive', 'reading'], ['Writing', 'The Reading Room', 'reading'], ['Music', 'The Listening Booth', 'music'], ['Video', 'The Cinema', 'video'], ['Theology', 'The Chapel', 'chapel'], ['Quotes', 'The Quote Book', 'quotes'], ['Profile', 'Profile', 'profile']];
  return `<button class="art-menu-scrim ${artMenuOpen ? 'is-open' : ''}" data-art-menu-dismiss aria-label="Close category menu"></button><aside class="art-menu ${artMenuOpen ? 'is-open' : ''}" aria-label="Browse artwork categories">
    <button class="art-menu-handle" data-art-menu-toggle aria-label="${artMenuOpen ? 'Close' : 'Open'} category menu"><span></span></button>
    <div class="art-menu-panel">
      <header><span>Browse</span><strong>${escapeHtml(gallery?.profile?.name || 'The archive')}</strong></header>
      <nav>${categories.map(([value, label, icon]) => {
        const count = value === 'Profile' ? gallery.profile?.evaluationCorpusSize || gallery.works.length : value === 'Quotes' ? gallery.works.reduce((sum, work) => sum + workQuotes(work).length, 0) : gallery.works.filter(work => matchesCategory(work, value)).length;
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

const fitHomeQuotes = () => {
  document.querySelectorAll('.home-hover-gallery-panel.is-words .portal-word-slide').forEach(slide => {
    const quote = slide.querySelector('q');
    if (!quote || !slide.clientWidth || !slide.clientHeight) return;
    const style = getComputedStyle(slide);
    const citation = slide.querySelector('small');
    const availableHeight = slide.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - (citation?.offsetHeight || 0) - 12;
    let low = 10;
    let high = 180;
    for (let pass = 0; pass < 10; pass += 1) {
      const size = (low + high) / 2;
      quote.style.fontSize = `${size}px`;
      if (quote.scrollHeight <= availableHeight) low = size;
      else high = size;
    }
    quote.style.fontSize = `${Math.floor(low * 10) / 10}px`;
  });
};
window.addEventListener('resize', () => requestAnimationFrame(fitHomeQuotes));
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

const homeShelfCard = (work, index, variant = '') => `<button class="home-shelf-card ${variant === 'rated' ? 'is-rated-card' : ''} ${workExternalUrl(work) ? 'is-linked-work' : ''} ${youtubeVideoId(work) ? 'has-hover-video' : ''}" data-work="${escapeHtml(work.id)}" ${youtubeVideoId(work) ? `data-hover-video="${escapeHtml(youtubeVideoId(work))}"` : ''} style="--delay:${index * 28}ms">
  ${variant === 'rated' ? `<span class="home-score" aria-hidden="true">${escapeHtml(workGrade(work))}</span>` : ''}
  <span class="home-shelf-art">${workCardVisual(work)}${variant === 'rated' ? `<span class="home-type-ribbon">${escapeHtml(work.medium || work.type || 'Artwork')}</span>` : ''}</span>
  <span class="home-shelf-copy"><strong>${escapeHtml(work.title)}</strong><em>${escapeHtml(work.medium || work.type || 'Archive work')}</em></span>
</button>`;
const publicCollectionHref = key => {
  const parameters = new URLSearchParams(location.search);
  parameters.set('section', activeType);
  if (key) parameters.set('collection', key);
  else parameters.delete('collection');
  return `${location.pathname}?${parameters.toString()}`;
};

const publicEntranceCard = ({ value, kicker, title, description, count, accent, marks, slides = [], wordSlides = [] }) => `<a class="public-entrance public-entrance-${accent}" data-home-portrait="${escapeHtml(accent)}" href="${PUBLIC_SITE_URLS[value]}">
  <span class="public-entrance-slideshow ${wordSlides.length ? 'is-words' : ''}" aria-hidden="true">${wordSlides.length ? wordSlides.map((slide, index) => `<span class="portal-slide portal-word-slide ${index === 0 ? 'is-active' : ''}"><q>${quoteLetterMarkup(slide.words)}</q><small>— ${escapeHtml(slide.title.toUpperCase())}</small></span>`).join('') : slides.map((source, index) => `<img class="portal-slide ${index === 0 ? 'is-active' : ''}" src="${escapeHtml(source)}" alt="" loading="${index === 0 ? 'eager' : 'lazy'}">`).join('')}</span>
  <span class="public-entrance-marks" aria-hidden="true">${escapeHtml(marks)}</span>
  <span class="public-entrance-kicker">${escapeHtml(kicker)}</span>
  <strong>${escapeHtml(title)}</strong>
  <span class="public-entrance-description">${escapeHtml(description)}</span>
  <span class="public-entrance-footer"><em>${count} ${count === 1 ? 'work' : 'works'}</em><b>Enter <span>↗</span></b></span>
</a>`;

const renderHome = works => {
  homePortalTimers.forEach(clearTimeout);
  homePortalTimers = [];
  const updateTime = work => Date.parse(work.addedAt || '') || 0;
  const recent = [...works].sort((left, right) => updateTime(right) - updateTime(left) || works.indexOf(right) - works.indexOf(left)).slice(0, 12);
  const latest = recent[0] || works[works.length - 1] || works[0];
  const workById = new Map(works.map(work => [String(work.permanentWorkId || work.id), work]));
  const exportedQuoteBook = Array.isArray(gallery?.quoteBook) ? gallery.quoteBook.map(quote => ({
    ...quote,
    work: workById.get(String(quote.permanentWorkId || quote.workId))
  })).filter(quote => quote.text && quote.work) : [];
  const publicQuotes = exportedQuoteBook.length
    ? exportedQuoteBook
    : works.flatMap(work => workQuotes(work).map(quote => ({ ...quote, work })));
  const quoteSignature = publicQuotes.map(quote => `${quote.text || quote.quote}|${quote.attribution || ''}|${quote.work?.id || ''}`).join('\n');
  if (quoteQueueSignature !== quoteSignature || !quoteQueue.length) {
    quoteQueueSignature = quoteSignature;
    quoteQueue = shuffledQuotes(publicQuotes);
  }
  const featuredQuote = quoteQueue.shift();
  if (featuredQuote) lastQuoteText = String(featuredQuote.text || featuredQuote.quote);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const searchResults = normalizedQuery ? works.filter(work => [
    work.title, work.medium, work.type, work.description, work.text, work.catalogId,
    ...(work.projects || []), ...(work.tags || []), ...workSubjects(work), ...(work.themes || []),
    ...(work.scripture || []), ...(work.doctrine || []), ...(work.joshSpeak || [])
  ].join(' ').toLowerCase().includes(normalizedQuery)) : [];
  const artWorks = works.filter(isArtWork);
  const videoWorks = works.filter(isVideoWork);
  const featuredVideoWorks = videoWorks.filter(work => {
    if (!youtubeVideoId(work)) return false;
    const labels = [
      work.title, work.description, work.text,
      ...(work.projects || []), ...(work.tags || []), ...(work.subjects || []),
      ...(work.collections || []), ...(work.themes || [])
    ].filter(Boolean).join(' ');
    return /(?:\bmake\s*ba\b|#makeba\b|\bsermon\b|\bsermons\b|\bpreach(?:ing|er|ed)?\b|\bhomiletic\b|pastor\s+josh\s+mcgary)/i.test(labels);
  });
  const thoughtWorks = works.filter(work => isWritingWork(work) || isTheologyWork(work) || isPoetryWork(work));
  const audioWorks = works.filter(isMusicWork);
  const playlistImages = playlistWorks => [...new Set(playlistWorks.map(work => {
    if (work.image) return work.image;
    if (String(work.media?.mimeType || '').startsWith('image/')) return workMediaSource(work);
    const youtubeId = youtubeVideoId(work);
    return youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : '';
  }).filter(Boolean))].slice(0, 16);
  const homeVideoLoops = [300, 301, 303, 304, 305, 308]
    .map(number => ({ kind: 'video', source: `./assets/video-loops/makeba-${number}.mp4`, poster: '' }));
  const thoughtWords = publicQuotes.map(quote => {
    const words = String(quote.text || quote.quote || '').replace(/\s+/g, ' ').trim();
    return words ? {
      title: quote.work?.title || 'Quote Book',
      words: words.length > 150 ? `${words.slice(0, 147).trim()}…` : words
    } : null;
  }).filter(Boolean).slice(0, 16);
  const entrances = [
    { value: 'Images', kicker: 'Drawing · painting · design · software', title: 'Art', description: 'Sketches, panels, design, objects, and visual systems.', count: artWorks.length, accent: 'art', marks: '◒', slides: playlistImages(artWorks) },
    { value: 'Thoughts', kicker: 'Writing · transcripts · poetry', title: 'Thoughts', description: 'Ideas, arguments, stories, teachings, and language across time.', count: thoughtWorks.length, accent: 'thoughts', marks: 'Aa', wordSlides: thoughtWords },
    { value: 'Video', kicker: 'MAKE BA · sermons', title: 'Video', description: 'MAKE BA and sermon video selections.', count: videoWorks.length, accent: 'video', marks: '▶', videoSlides: homeVideoLoops },
    { value: 'Music', kicker: 'Music · voice · sound', title: 'Audio', description: 'Songs, performances, recordings, and experiments in sound.', count: audioWorks.length, accent: 'audio', marks: '∿', slides: playlistImages(audioWorks) }
  ];
  const portalSlideMarkup = entrance => entrance.wordSlides?.length
    ? entrance.wordSlides.map((slide, index) => `<span class="portal-slide portal-word-slide ${index === 0 ? 'is-active' : ''}"><q>${quoteLetterMarkup(slide.words)}</q><small>— ${escapeHtml(slide.title.toUpperCase())}</small></span>`).join('')
    : entrance.videoSlides?.length
      ? entrance.videoSlides.map((slide, index) => slide.kind === 'youtube'
        ? `<span class="portal-slide portal-video-slide ${index === 0 ? 'is-active' : ''}" data-video-kind="youtube" data-video-src="${escapeHtml(slide.source)}"${slide.poster ? ` style="--video-poster:url('${escapeHtml(slide.poster)}')"` : ''}><iframe title="" tabindex="-1" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin"></iframe></span>`
        : slide.kind === 'video'
          ? `<span class="portal-slide portal-video-slide ${index === 0 ? 'is-active' : ''}" data-video-kind="video"><video src="${escapeHtml(slide.source)}" ${slide.poster ? `poster="${escapeHtml(slide.poster)}"` : ''} muted loop playsinline preload="auto"></video></span>`
          : `<img class="portal-slide ${index === 0 ? 'is-active' : ''}" src="${escapeHtml(slide.source)}" alt="" loading="${index === 0 ? 'eager' : 'lazy'}">`).join('')
      : (entrance.slides || []).map((source, index) => `<img class="portal-slide ${index === 0 ? 'is-active' : ''}" src="${escapeHtml(source)}" alt="" loading="${index === 0 ? 'eager' : 'lazy'}">`).join('');
  const initialPortal = entrances[Math.floor(Math.random() * entrances.length)]?.accent || 'art';
  const shelves = [
    ...(normalizedQuery ? [[`Results for “${searchQuery.trim()}”`, searchResults]] : []),
    ['Recently added', recent],
    ['Images', works.filter(isImageWork)],
    ['Poetry', works.filter(isPoetryWork)],
    ['Music', works.filter(isMusicWork)],
    ['Video', works.filter(isVideoWork)],
    ['Writing', works.filter(work => !isPoetryWork(work) && (['writing', 'prose', 'essay', 'story', 'document'].includes(String(work.type || work.medium || '').toLowerCase()) || work.media?.mimeType === 'application/pdf' || work.mimeType === 'application/pdf'))]
  ].filter(([, shelfWorks]) => shelfWorks.length);
  app.innerHTML = `<div class="shell home-shell simple-public-home">
    ${renderTopbar()}
    <main>
      <img class="home-self-portrait" data-home-portrait="self" src="./assets/josh-self-portrait.png" alt="Self-portrait of Josh McGary seated with a sketchbook">
      <section class="home-hover-gallery" aria-live="polite">
        ${entrances.map(entrance => `<div class="home-hover-gallery-panel public-entrance-slideshow ${entrance.wordSlides?.length ? 'is-words' : ''} ${entrance.videoSlides?.length ? 'is-video' : ''}" data-home-panel="${escapeHtml(entrance.accent)}" aria-hidden="true">${portalSlideMarkup(entrance)}</div>`).join('')}
      </section>
      <section class="home-portal-stage" aria-live="polite">
        ${entrances.map(entrance => `<a href="${PUBLIC_SITE_URLS[entrance.value]}" class="home-portal-panel" data-home-panel-trigger="${escapeHtml(entrance.accent)}" aria-label="Open ${escapeHtml(entrance.title)}"><strong class="home-portal-icon" aria-hidden="true">${escapeHtml(entrance.title)}</strong></a>`).join('')}
      </section>
    </main>
  </div>`;
  bindActions();
  requestAnimationFrame(() => requestAnimationFrame(fitHomeQuotes));
  const portrait = document.querySelector('.home-self-portrait');
  const portraitSources = [
    './assets/josh-self-portrait.png',
    './assets/josh-self-portrait-thoughts.png',
    './assets/josh-self-portrait-art.png',
    './assets/josh-self-portrait-video.png',
    './assets/josh-self-portrait-audio.png'
  ];
  const setPortalVideoPlayback = (slide, playing, unload = false) => {
    if (!slide?.classList.contains('portal-video-slide')) return;
    const frame = slide.querySelector('iframe');
    const video = slide.querySelector('video');
    if (frame) {
      const sendYouTubeCommand = command => frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: command, args: [] }), '*');
      const startYouTube = () => {
        sendYouTubeCommand('mute');
        sendYouTubeCommand('playVideo');
      };
      if (playing) {
        if (!frame.getAttribute('src')) {
          frame.addEventListener('load', () => {
            startYouTube();
            setTimeout(startYouTube, 350);
            setTimeout(startYouTube, 900);
          }, { once: true });
          frame.src = slide.dataset.videoSrc;
        } else {
          startYouTube();
          setTimeout(startYouTube, 250);
          setTimeout(startYouTube, 700);
        }
      } else if (frame.getAttribute('src')) {
        sendYouTubeCommand(unload ? 'stopVideo' : 'pauseVideo');
        if (unload) frame.removeAttribute('src');
      }
    }
    if (video) {
      video.muted = true;
      if (playing) {
        if (video.ended) video.currentTime = 0;
        video.play().catch(() => {});
      } else {
        video.pause();
        if (unload) video.currentTime = 0;
      }
    }
  };
  document.querySelectorAll('[data-home-panel="video"] video').forEach(video => {
    video.muted = true;
    video.load();
  });
  document.querySelectorAll('.public-entrance-slideshow').forEach((slideshow, index) => {
    const images = [...slideshow.querySelectorAll('.portal-slide')];
    if (images.length < 2) return;
    const isWords = slideshow.classList.contains('is-words');
    const isVideo = slideshow.classList.contains('is-video');
    let currentIndex = 0;
    const cycle = () => {
      if (!slideshow.isConnected) return;
      if (isVideo && !slideshow.classList.contains('is-active')) {
        homePortalTimers.push(setTimeout(cycle, 2000));
        return;
      }
      let nextIndex = Math.floor(Math.random() * images.length);
      if (nextIndex === currentIndex) nextIndex = (nextIndex + 1) % images.length;
      images[currentIndex].classList.remove('is-active');
      setPortalVideoPlayback(images[currentIndex], false, isVideo);
      images[nextIndex].classList.add('is-active');
      setPortalVideoPlayback(images[nextIndex], slideshow.classList.contains('is-active'));
      currentIndex = nextIndex;
      homePortalTimers.push(setTimeout(cycle, isWords ? 9000 + Math.random() * 3000 : isVideo ? 9000 + Math.random() * 5000 : 2600 + Math.random() * 1800));
    };
    homePortalTimers.push(setTimeout(cycle, 700 + index * 520 + Math.random() * 600));
  });
  const activateHomePanel = accent => {
    document.querySelectorAll('[data-home-panel]').forEach(panel => {
      const active = panel.dataset.homePanel === accent;
      const wasActive = panel.classList.contains('is-active');
      if (active && !wasActive && panel.classList.contains('is-words')) {
        const quote = panel.querySelector('.portal-word-slide.is-active');
        if (quote) {
          quote.classList.remove('is-active');
          void quote.offsetWidth;
          quote.classList.add('is-active');
        }
      }
      panel.classList.toggle('is-active', active);
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
      panel.querySelectorAll('.portal-video-slide').forEach(slide => setPortalVideoPlayback(slide, active && slide.classList.contains('is-active')));
    });
    document.querySelectorAll('[data-home-panel-trigger]').forEach(trigger => trigger.classList.toggle('is-active', trigger.dataset.homePanelTrigger === accent));
  };
  const deactivateHomePanel = () => {
    document.querySelectorAll('[data-home-panel]').forEach(panel => {
      panel.classList.remove('is-active');
      panel.setAttribute('aria-hidden', 'true');
    });
    document.querySelectorAll('[data-home-panel-trigger]').forEach(trigger => trigger.classList.remove('is-active'));
    document.querySelector('.simple-public-home')?.classList.remove('is-gallery-active');
  };
  document.querySelectorAll('[data-home-panel-trigger]').forEach(trigger => {
    trigger.addEventListener('pointerenter', () => {
      activateHomePanel(trigger.dataset.homePanelTrigger);
      document.querySelector('.simple-public-home')?.classList.add('is-gallery-active');
    });
    trigger.addEventListener('pointerleave', deactivateHomePanel);
    trigger.addEventListener('focus', () => {
      activateHomePanel(trigger.dataset.homePanelTrigger);
      document.querySelector('.simple-public-home')?.classList.add('is-gallery-active');
    });
    trigger.addEventListener('blur', deactivateHomePanel);
  });
  let portraitSwapTimer;
  let portraitFinishTimer;
  let portraitZoneActive = false;
  const spinPortrait = () => {
    if (!portrait) return;
    const currentSource = portrait.getAttribute('src');
    const choices = portraitSources.filter(source => source !== currentSource);
    const nextSource = choices[Math.floor(Math.random() * choices.length)];
    clearTimeout(portraitSwapTimer);
    clearTimeout(portraitFinishTimer);
    portrait.classList.remove('is-coin-spinning');
    void portrait.offsetWidth;
    portrait.classList.add('is-coin-spinning');
  portraitSwapTimer = setTimeout(() => {
    portrait.src = nextSource;
  }, 240);
    portraitFinishTimer = setTimeout(() => portrait.classList.remove('is-coin-spinning'), 520);
  };
  portrait?.addEventListener('pointermove', event => {
    const bounds = portrait.getBoundingClientRect();
    const normalizedX = (event.clientX - bounds.left) / bounds.width;
    const normalizedY = (event.clientY - bounds.top) / bounds.height;
    const insideCenter = normalizedX >= .24 && normalizedX <= .76 && normalizedY >= .13 && normalizedY <= .87;
    portrait.style.cursor = insideCenter ? 'pointer' : 'default';
    if (insideCenter && !portraitZoneActive) spinPortrait();
    portraitZoneActive = insideCenter;
  });
  portrait?.addEventListener('pointerleave', () => {
    portraitZoneActive = false;
    portrait.style.cursor = 'default';
  });
  document.querySelector('[data-home-search]')?.addEventListener('input', event => {
    searchQuery = event.target.value;
    const cursor = searchQuery.length;
    renderHome(works);
    const input = document.querySelector('[data-home-search]');
    input?.focus(); input?.setSelectionRange(cursor, cursor);
  });
  document.querySelector('[data-clear-home-search]')?.addEventListener('click', () => { searchQuery = ''; renderHome(works); });
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

const renderPublicSection = works => {
  clearInterval(searchPromptTimer);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const labels = { Images: 'Art', Video: 'Video', Music: 'Audio' };
  const descriptions = {
    Images: '',
    Video: '',
    Music: 'Songs, recordings, performances, voice, and experiments in sound.'
  };
  const sectionWorks = works.filter(work => matchesCategory(work, activeType));
  const visible = currentCollectionWorks();
  const previewable = visible;
  const compareWorkDate = (left, right) => Date.parse(right.date || '') - Date.parse(left.date || '') || Date.parse(right.addedAt || '') - Date.parse(left.addedAt || '') || String(left.title || '').localeCompare(String(right.title || ''));
  const years = [...new Set(sectionWorks.map(work => String(work.date || work.addedAt || '').slice(0, 4)).filter(year => /^\d{4}$/.test(year)))].sort((left, right) => right.localeCompare(left));
  const ages = [...new Set(sectionWorks.map(workAge).filter(Boolean))].sort((left, right) => Number(left) - Number(right));
  const ageMenu = `<nav class="public-age-menu" aria-label="Filter ${labels[activeType]} by age"><span>Age</span>${['All', ...ages].map(age => `<button class="${activePublicAge === age ? 'is-active' : ''}" data-public-age="${escapeHtml(age)}">${escapeHtml(age)}</button>`).join('')}</nav>`;
  const workYear = work => String(work.date || work.addedAt || '').slice(0, 4);
  const accessionTime = work => Date.parse(work.addedAt || work.metadata?.addedAt || '') || 0;
  const latestAdded = [...previewable].sort((left, right) => Number(right.order ?? -1) - Number(left.order ?? -1) || accessionTime(right) - accessionTime(left) || compareWorkDate(left, right)).slice(0, 24);
  const uniqueRails = [
    { key: '', title: 'Latest Added', items: latestAdded, latest: true },
    ...years.map(year => ({ key: `year:${year}`, title: year, items: previewable.filter(work => workYear(work) === year).sort(compareWorkDate) }))
  ].filter(rail => rail.items.length);
  const catalogueWorks = [...visible].sort((left, right) => String(left.title || '').localeCompare(String(right.title || '')) || compareWorkDate(left, right));
  const catalogueYears = [...new Set(catalogueWorks.map(work => workYear(work) || 'Undated'))].sort((left, right) => {
    if (left === 'Undated') return 1;
    if (right === 'Undated') return -1;
    return right.localeCompare(left);
  });
  const catalogueGroups = catalogueYears.map(year => ({
    year,
    works: catalogueWorks.filter(work => (workYear(work) || 'Undated') === year)
  }));
  const collectionMatches = work => {
    if (!activePublicCollection || activePublicCollection === 'all') return true;
    if (activePublicCollection.startsWith('year:')) return workYear(work) === activePublicCollection.slice(5);
    return true;
  };
  const activeRail = uniqueRails.find(rail => rail.key === activePublicCollection);
  if (activePublicCollection) {
    const collectionTitle = activePublicCollection.startsWith('year:') ? activePublicCollection.slice(5) : activeRail?.title || 'Collection';
    const yearWorks = sectionWorks.filter(collectionMatches).sort(compareWorkDate);
    const gridWorks = previewable.filter(collectionMatches).sort(compareWorkDate);
    const yearTagCounts = new Map();
    yearWorks.forEach(work => [...workSubjects(work), ...(work.tags || []), ...(work.themes || []), ...(work.projects || [])].filter(Boolean).forEach(term => {
      const clean = String(term).replace(/^\[|\]$/g, '').replace(/^#/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
      const key = clean.toLocaleLowerCase();
      if (clean.length > 1 && !['none', 'n/a', 'uncategorized', 'unclassified', 'unknown'].includes(key)) {
        const previous = yearTagCounts.get(key);
        yearTagCounts.set(key, { label: previous?.label || clean, count: (previous?.count || 0) + 1 });
      }
    }));
    const yearTags = [...yearTagCounts.values()].filter(({ count }) => count > 1).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)).slice(0, 60);
    const yearIndex = [...gridWorks].sort((left, right) => String(left.title || '').localeCompare(String(right.title || '')));
    app.innerHTML = `<div class="public-section-shell public-grid-shell">
      ${renderTopbar()}
      <main>
        <a class="public-grid-back" href="${escapeHtml(publicCollectionHref(''))}" data-close-public-collection>← ${labels[activeType]}</a>
        <header class="public-grid-intro"><p>${gridWorks.length} ${gridWorks.length === 1 ? 'work' : 'works'}</p><h1>${escapeHtml(collectionTitle)}</h1></header>
        <label class="public-section-search"><span>Search collection</span><input type="search" value="${escapeHtml(searchQuery)}" placeholder="Title, subject, medium, year…" data-search></label>
        ${ageMenu}
        <section class="public-card-catalogue"><button class="public-disclosure" data-disclosure aria-expanded="false" aria-controls="year-index"><span>${collectionTitle} index</span><em>${yearIndex.length} cards</em></button><div id="year-index" hidden>${yearIndex.map(work => `<button data-work="${escapeHtml(work.id)}"><strong>${escapeHtml(work.title)}</strong><span>${escapeHtml(work.medium || work.type || 'Artwork')}</span><em>${escapeHtml(work.catalogId || '')}</em></button>`).join('')}</div></section>
        <section class="public-tag-cloud"><button class="public-disclosure" data-disclosure aria-expanded="false" aria-controls="year-subjects"><span>Subjects in ${escapeHtml(collectionTitle)}</span><em>${yearTags.length} recurring terms</em></button><div id="year-subjects" hidden>${yearTags.map(({ label, count }) => `<button data-index-term="${escapeHtml(label)}" style="--tag-weight:${Math.min(2.2, .85 + count / 8)}"><span>${escapeHtml(label)}</span><em>${count}</em></button>`).join('')}</div></section>
        <div class="public-work-grid">${gridWorks.map((work, index) => homeShelfCard(work, index)).join('')}</div>
        ${gridWorks.length ? '' : `<p class="public-section-empty">No works in this collection match the current search.</p>`}
      </main>
      <footer><button data-home>Josh McGary</button><span>${labels[activeType]} · ${escapeHtml(collectionTitle)}</span></footer>
    </div>`;
    bindActions();
    if (activeType === 'Images' && publicArchiveHost) hydrateVisiblePublicCards();
    return;
  }
  const publishedCount = gallery?.stats?.sectionCounts?.[activeType === 'Images' ? 'art' : activeType === 'Video' ? 'video' : 'audio'] || sectionWorks.length;
  app.innerHTML = `<div class="public-section-shell ${activeType === 'Video' ? 'has-video-hero' : ''} ${normalizedQuery ? 'has-open-catalogue' : ''}">
    ${renderTopbar()}
    <main>
      <header class="public-section-intro"><p>${publishedCount} ${publishedCount === 1 ? 'work' : 'works'}</p><h1>${labels[activeType]}</h1><figure class="public-hover-preview ${activeType === 'Video' ? 'is-visible' : ''}" data-hover-preview aria-hidden="${activeType === 'Video' ? 'false' : 'true'}">${activeType === 'Video' ? '<video src="./assets/video-loops/sermon-suffering-mid.mp4" muted loop autoplay playsinline preload="auto" aria-label="Muted sermon preview from Suffering is not removed by salvation"></video>' : ''}</figure><span class="public-preview-title" data-preview-title aria-live="polite"></span>${descriptions[activeType] ? `<span>${descriptions[activeType]}</span>` : ''}</header>
      <div class="public-search-cluster"><label class="public-section-search"><span>Search ${labels[activeType]}</span><input type="search" value="${escapeHtml(searchQuery)}" placeholder="" data-search data-cycling-search></label><button class="public-catalogue-toggle" data-disclosure aria-expanded="${normalizedQuery ? 'true' : 'false'}" aria-controls="complete-catalogue" aria-label="${normalizedQuery ? 'Close' : 'Open'} complete card catalogue">▼</button></div>
      ${ageMenu}
      <section class="public-card-catalogue public-card-catalogue-years public-inline-catalogue"><div id="complete-catalogue" ${normalizedQuery ? '' : 'hidden'}>${catalogueGroups.map(group => `<section><header><a href="${escapeHtml(publicCollectionHref(`year:${group.year}`))}" data-public-collection="year:${escapeHtml(group.year)}"><strong>${escapeHtml(group.year)}</strong><em>${group.works.length}</em><span>Open year →</span></a></header><div>${group.works.map(work => `<button data-work="${escapeHtml(work.id)}"><strong>${escapeHtml(work.title)}</strong><span>${escapeHtml(work.medium || work.type || 'Artwork')}</span><em>${escapeHtml(work.catalogId || '')}</em></button>`).join('')}</div></section>`).join('')}</div></section>
      <div class="public-section-rails">${uniqueRails.map((rail, railIndex) => `<section class="public-section-rail ${rail.latest ? 'is-latest-added' : ''}"><header>${rail.latest ? `<div class="public-rail-title"><h2>${escapeHtml(rail.title)}</h2><span>${rail.items.length}</span><em>Newest archive accessions</em></div>` : `<a class="public-rail-title" href="${escapeHtml(publicCollectionHref(rail.key))}" data-public-collection="${escapeHtml(rail.key)}"><h2>${escapeHtml(rail.title)}</h2><span>${rail.items.length}</span><em>View all →</em></a>`}<nav><button data-rail-scroll="back" data-rail="${railIndex}" aria-label="Scroll ${escapeHtml(rail.title)} backward">←</button><button data-rail-scroll="forward" data-rail="${railIndex}" aria-label="Scroll ${escapeHtml(rail.title)} forward">→</button></nav></header><div data-rail-track="${railIndex}">${rail.items.map((work, index) => homeShelfCard(work, index)).join('')}</div></section>`).join('')}${visible.length ? '' : `<p class="public-section-empty">No ${labels[activeType].toLowerCase()} matches this search.</p>`}</div>
    </main>
    <footer><button data-home>Josh McGary</button><span>${labels[activeType]}</span></footer>
  </div>`;
  bindActions();
  if (activeType === 'Images' && publicArchiveHost) hydrateVisiblePublicCards();
};

const profileScore = key => {
  const values = (gallery?.works || []).map(work => Number.parseFloat(work[key] ?? work.metadata?.[key])).filter(Number.isFinite);
  if (values.length) return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1);
  const signature = gallery?.profile?.creativeSignature;
  const signatureValue = key === 'grade'
    ? signature?.averageGrade
    : signature?.averages?.[key] ?? signature?.dimensionAverages?.[key] ?? signature?.[`average${key.charAt(0).toUpperCase()}${key.slice(1)}`];
  if (Number.isFinite(Number.parseFloat(signatureValue))) return Number.parseFloat(signatureValue).toFixed(1);
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(gallery?.profile?.evaluation || '').match(new RegExp(`${escaped}[^0-9]{0,20}([0-9]+(?:\\.[0-9]+)?)`, 'i'));
  return match ? Number.parseFloat(match[1]).toFixed(1) : '—';
};

const profileSections = text => {
  const sections = [];
  let current = { title: 'Critical profile', paragraphs: [] };
  let inCodeBlock = false;
  String(text || '').replace(/\\n/g, '\n').split('\n').forEach(raw => {
    const source = raw.trim();
    if (/^```/.test(source)) {
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (inCodeBlock) return;
    const line = source.replace(/[│┃║]/g, '|').trim();
    if (!line) return;
    const isRule = /^(?:[|:+—–_=\-\s─-╿\\/<>]|\[|\]){3,}$/.test(line);
    const visualLayout = line.includes('|')
      || /[┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬]/.test(line)
      || /(?:-{3,}|={3,}|_{3,}|—{3,}|─{3,})/.test(line)
      || /(?:→|←|↔|⇒|⇐|▶|►|◀|◄)/.test(line)
      || /^\+[-=+]+\+$/.test(line)
      || /^(metric|score|core definition|structural function|primary vector|observed cross-medium)\b/i.test(line);
    if (visualLayout || isRule) return;
    if (/^#{1,3}\s+/.test(line) || /^\*\*.+\*\*$/.test(line)) {
      if (current.paragraphs.length) sections.push(current);
      current = { title: line.replace(/[#*]/g, '').trim(), paragraphs: [] };
    } else {
      const prose = line
        .replace(/^[-*•]\s*/, '')
        .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
        .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim();
      if (/[A-Za-z0-9]/.test(prose)) current.paragraphs.push(prose);
    }
  });
  if (current.paragraphs.length) sections.push(current);
  return sections;
};

const profileParagraphMarkup = (paragraph, works) => {
  const citedWorks = works
    .filter(work => String(work.title || '').trim().length >= 4)
    .sort((a, b) => String(b.title).length - String(a.title).length);
  if (!citedWorks.length) return escapeHtml(paragraph);
  const escapedTitles = citedWorks.map(work => String(work.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const matcher = new RegExp(`(${escapedTitles.join('|')})`, 'gi');
  let cursor = 0;
  let markup = '';
  for (const match of String(paragraph).matchAll(matcher)) {
    const work = citedWorks.find(candidate => String(candidate.title).toLowerCase() === match[0].toLowerCase());
    markup += escapeHtml(String(paragraph).slice(cursor, match.index));
    markup += work ? `<button type="button" class="profile-citation" data-profile-citation="${escapeHtml(work.id)}">${escapeHtml(match[0])}</button>` : escapeHtml(match[0]);
    cursor = match.index + match[0].length;
  }
  return markup + escapeHtml(String(paragraph).slice(cursor));
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
  const dimensions = [
    ['Cleverness', profileScore('cleverness'), 'Ingenuity, wit, and inventive problem-solving'],
    ['Greatness', profileScore('greatness'), 'Artistic impact, ambition, and consequence'],
    ['Proficiency', profileScore('proficiency'), 'Command, finish, and execution consistency'],
    ['Expertise', profileScore('expertise'), 'Depth of knowledge and control of the medium']
  ];
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
      <section class="profile-dimensions" aria-label="Creative dimensions"><header><p class="eyebrow">Creative dimensions</p><h2>The character of the complete practice.</h2></header><div>${dimensions.map(([label, score, definition]) => `<article><div><strong>${label}</strong><span>${score} / 10</span></div><i style="--dimension-score:${Number.isFinite(Number.parseFloat(score)) ? Math.min(100, Number.parseFloat(score) * 10) : 0}%"></i><p>${definition}</p></article>`).join('')}</div></section>
      <section class="profile-practice"><div><p class="eyebrow">Multimodal practice</p><h2>A body of work without a single container.</h2></div><div class="profile-mediums">${media.map(([label, count]) => `<div><header><strong>${escapeHtml(label)}</strong><span>${count}</span></header><i style="--profile-bar:${Math.round((count / maxMedium) * 100)}%"></i></div>`).join('')}</div></section>
      ${sections.length ? `<section class="profile-critical"><header><p class="eyebrow">Corpus intelligence</p><h2>Critical profile</h2><p>${profile.evaluationUpdatedAt ? `Synthesized ${escapeHtml(new Date(profile.evaluationUpdatedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}` : `${works.length} works considered`}</p></header><div class="profile-essay">${sections.map(section => `<article><h3>${escapeHtml(section.title)}</h3>${section.paragraphs.map(paragraph => `<p>${profileParagraphMarkup(paragraph, works)}</p>`).join('')}</article>`).join('')}</div></section>` : `<section class="profile-critical profile-awaiting"><p class="eyebrow">Corpus intelligence</p><h2>Awaiting the artist’s public corpus evaluation.</h2><p>Publish an Artistic Profile from Archivist to complete this page.</p></section>`}
      ${tags.length ? `<section class="profile-signals"><p class="eyebrow">Recurring constellations</p><div>${tags.map(([tag, count]) => `<span>${escapeHtml(tag)} <em>${count}</em></span>`).join('')}</div></section>` : ''}
      ${strongest.length ? `<section class="home-shelf profile-evidence"><header><h2>Evidence in the archive</h2><span>${strongest.length}</span></header><div class="home-shelf-track">${strongest.map((work, index) => homeShelfCard(work, index)).join('')}</div></section>` : ''}
      <footer><span>Artist profile · ${works.length} works</span>${profile.contact ? `<a href="mailto:${encodeURIComponent(profile.contact)}">Contact</a>` : ''}</footer>
    </main><div class="citation-viewer" data-citation-viewer aria-hidden="true"><button class="citation-viewer-scrim" data-citation-close aria-label="Close cited artwork"></button><figure><button data-citation-close aria-label="Close cited artwork">×</button><div data-citation-art></div><figcaption><strong data-citation-title></strong><span>Referenced in the critical profile</span></figcaption></figure></div>${renderDock()}
  </div>`;
  bindActions();
};

const renderQuoteBook = works => {
  clearInterval(quoteCycleTimer);
  setCardViewLock(false);
  const quotes = works.flatMap(work => workQuotes(work).map((quote, index) => ({
    ...quote,
    index,
    work,
    subjects: workSubjects(work).length ? workSubjects(work) : ['Uncategorized']
  })));
  const subjectCounts = new Map();
  quotes.forEach(quote => quote.subjects.forEach(subject => subjectCounts.set(subject, (subjectCounts.get(subject) || 0) + 1)));
  const subjects = ['All', ...[...subjectCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([subject]) => subject)];
  const query = searchQuery.trim().toLowerCase();
  const visible = quotes.filter(quote => (activeSubject === 'All' || quote.subjects.includes(activeSubject)) && (!query || [quote.text, quote.quote, quote.attribution, quote.work.title, quote.work.catalogId, ...quote.subjects].join(' ').toLowerCase().includes(query)))
    .sort((left, right) => (Date.parse(right.work.addedAt || '') || 0) - (Date.parse(left.work.addedAt || '') || 0) || left.index - right.index);
  app.innerHTML = `<div class="quote-book-shell">${renderTopbar()}
    <header class="quote-book-head"><p class="eyebrow">Language worth keeping</p><h1>The Quote Book</h1><p>${quotes.length} compiled statements from ${new Set(quotes.map(quote => quote.work.id)).size} source works.</p></header>
    <main class="quote-book-layout"><aside class="quote-subject-index"><label>Search quotes<input type="search" value="${escapeHtml(searchQuery)}" placeholder="Words, subjects, sources…" data-search></label><nav>${subjects.map(subject => `<button class="${subject === activeSubject ? 'is-active' : ''}" data-subject="${escapeHtml(subject)}"><span>${escapeHtml(subject)}</span><em>${subject === 'All' ? quotes.length : subjectCounts.get(subject)}</em></button>`).join('')}</nav></aside>
    <section><p class="quote-result-count">${visible.length} ${visible.length === 1 ? 'quote' : 'quotes'}${activeSubject !== 'All' ? ` about ${escapeHtml(activeSubject)}` : ''}</p><div class="quote-card-grid">${visible.map(quote => `<button class="quote-book-card" data-quote-source="${escapeHtml(quote.work.id)}"><span class="quote-mark">”</span><blockquote>“${escapeHtml(quote.text || quote.quote)}”</blockquote><cite>— ${escapeHtml(quote.attribution || gallery.profile?.name || 'The Artist')}</cite><footer><strong>${escapeHtml(quote.work.title)}</strong><em>${escapeHtml(quote.work.catalogId || quote.work.type || '')}</em></footer></button>`).join('')}</div></section></main>${renderDock()}</div>`;
  bindActions();
  document.querySelectorAll('[data-quote-source]').forEach(button => button.addEventListener('click', () => {
    const source = works.find(work => String(work.id) === button.dataset.quoteSource);
    if (!source) return;
    activeType = 'All'; activeProject = 'All'; activeSubject = 'All'; activeTag = 'All'; searchQuery = '';
    renderWork(source);
  }));
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
  if (['Images', 'Video', 'Music'].includes(activeType)) {
    renderPublicSection(works);
    return;
  }
  if (activeType === 'Profile') {
    renderProfile(works);
    return;
  }
  if (activeType === 'Quotes') {
    renderQuoteBook(works);
    return;
  }
  const categoryWorks = works.filter(work => matchesCategory(work, activeType));
  const categoryUpdateTime = work => Date.parse(work.addedAt || '') || 0;
  const featuredCategoryWorks = activeProject === 'All' ? categoryWorks : categoryWorks.filter(work => work.projects?.includes(activeProject));
  const categoryLatest = [...featuredCategoryWorks].sort((left, right) => categoryUpdateTime(right) - categoryUpdateTime(left) || featuredCategoryWorks.indexOf(right) - featuredCategoryWorks.indexOf(left))[0] || categoryWorks[0] || works[0];
  const projects = ['All', ...new Set(categoryWorks.flatMap(work => work.projects || []))];
  const types = ['All', ...new Set(categoryWorks.map(work => work.type || work.medium).filter(Boolean))];
  const tags = ['All', ...new Set(categoryWorks.flatMap(work => work.tags || []))];
  const subjects = ['All', ...new Set(categoryWorks.flatMap(work => workSubjects(work)))];
  const filteredWorks = currentCollectionWorks();
  const gradeScore = work => Number.parseFloat(workGrade(work)) || -Infinity;
  const updateTime = work => Date.parse(work.addedAt || '') || 0;
  const categoryShelves = [
    ['Recently added', [...filteredWorks].sort((a, b) => updateTime(b) - updateTime(a)).slice(0, 16)],
    ...projects.filter(project => project !== 'All').map(project => [project, filteredWorks.filter(work => work.projects?.includes(project))])
  ].filter(([, shelfWorks]) => shelfWorks.length);
  const years = categoryWorks.map(work => String(work.date || '').slice(0, 4)).filter(year => /^\d{4}$/.test(year)).map(Number).sort();
  const activeFilters = [activeProject !== 'All' && activeProject, activeSubject !== 'All' && activeSubject, activeTag !== 'All' && `#${activeTag}`].filter(Boolean);
  const writingVolumes = activeType === 'Writing' ? projects.filter(project => project !== 'All' && project.toLowerCase() !== 'bible thoughts').map(project => ({
    name: project,
    items: categoryWorks.filter(work => work.projects?.includes(project))
  })).filter(volume => volume.items.length).sort((a, b) => {
    const bibleDifference = bibleBookOrder(a.name) - bibleBookOrder(b.name);
    return bibleDifference || a.name.localeCompare(b.name);
  }) : [];
  app.innerHTML = `<div class="shell category-shell">
    ${renderTopbar()}
    ${writingVolumes.length ? `<section class="docent-library" aria-label="Writing library"><header><p class="eyebrow">Writing library</p><h2>Select a volume</h2><span>${writingVolumes.length} books</span></header><div class="docent-library-shelf">${writingVolumes.map(volume => `<button data-project="${escapeHtml(volume.name)}" class="${activeProject === volume.name ? 'is-active' : ''}" style="--book-height:${Math.min(176, 112 + Math.log2(volume.items.length + 1) * 14)}px;--book-width:${Math.min(66, 42 + Math.log2(volume.items.length + 1) * 5)}px" title="${escapeHtml(volume.name)} — ${volume.items.length} writings"><span>${escapeHtml(volume.name)}</span><em>${volume.items.length}</em></button>`).join('')}</div></section>` : ''}
    <section class="home-feature category-feature" aria-label="Latest in ${escapeHtml(activeType)}">
      <div class="home-feature-media">${workCardVisual(categoryLatest)}</div>
      <div class="home-feature-shade"></div>
      <div class="home-feature-copy"><p class="eyebrow">Latest in ${escapeHtml(activeType)}</p><h1>${escapeHtml(categoryLatest.title)}</h1><p>${escapeHtml(categoryLatest.description || categoryLatest.medium || categoryLatest.type || `The newest work in ${activeType}.`)}</p><button data-work="${escapeHtml(categoryLatest.id)}">View work <span>→</span></button></div>
    </section>
    <section class="collection-tools" id="collection">
      <label class="search"><span>Search collection</span><input type="search" value="${escapeHtml(searchQuery)}" placeholder="Title, medium, year, project…" data-search></label>
      <details class="facet-drawer" ${activeFilters.length ? 'open' : ''}>
        <summary><span>Filter collection</span><em>${activeFilters.length ? escapeHtml(activeFilters.join(' · ')) : 'Project · Subjects · Tags'}</em></summary>
        <details class="project-rolodex">
          <summary><span>Project</span><strong>${escapeHtml(activeProject === 'All' ? 'All projects' : activeProject)}</strong><em>${projects.length - 1}</em></summary>
          <div class="rolodex-stack">${projects.map((project, index) => `<button class="${project === activeProject ? 'is-active' : ''}" data-project="${escapeHtml(project)}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(project)}</strong><em>${project === 'All' ? categoryWorks.length : categoryWorks.filter(work => work.projects?.includes(project)).length}</em></button>`).join('')}</div>
        </details>
        <div class="facet-group"><label>Subjects</label><div class="filter-row">${subjects.map(subject => `<button class="filter-chip ${subject === activeSubject ? 'is-active' : ''}" data-subject="${escapeHtml(subject)}">${escapeHtml(subject)}</button>`).join('')}</div></div>
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
        <div><strong>${subjects.length - 1}</strong><span>Subjects</span></div>
        <div><strong>${years.length ? `${years[0]}–${years[years.length - 1]}` : '—'}</strong><span>Date range</span></div>
        <div><strong>${filteredWorks.length}</strong><span>Currently visible</span></div>
      </div>
    </details>
    <main class="home-shelves category-shelves">
      ${categoryShelves.map(([title, shelfWorks, variant]) => `<section class="home-shelf ${variant === 'rated' ? 'is-rated-shelf' : ''}"><header><h2>${escapeHtml(title)}</h2><span>${shelfWorks.length}</span></header><div class="home-shelf-track">${shelfWorks.map((work, index) => homeShelfCard(work, index, variant)).join('')}</div></section>`).join('')}
      ${filteredWorks.length ? '' : '<div class="no-results"><strong>No works found</strong><span>Try another search or project.</span></div>'}
    </main>
    <button class="about-panel" id="about" data-open-profile><span class="eyebrow">About the collection</span><h2>${escapeHtml(gallery.profile?.name || 'The Artist')}</h2>${gallery.profile?.statement ? `<span>${escapeHtml(gallery.profile.statement)}</span>` : '<span>A public collection of art, language, and sound.</span>'}</button>
    <footer><span>${categoryWorks.length} ${categoryWorks.length === 1 ? 'work' : 'works'} in ${activeType === 'All' ? 'the collection' : escapeHtml(activeType)}</span>${gallery.profile?.contact ? `<a href="mailto:${encodeURIComponent(gallery.profile.contact)}">Contact</a>` : ''}</footer>
  </div>`;
  bindActions();
};

const renderWork = work => {
  setCardViewLock(true);
  const works = currentCollectionWorks();
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
        <section class="detail-face detail-back"><div class="detail-back-layout">
          <div class="detail-back-preview">${workCardVisual(work)}</div>
          <div class="detail-back-info">
          <p class="eyebrow">${escapeHtml(work.projects?.join(' · ') || 'Selected work')}</p>
          <h1>${escapeHtml(work.title)}</h1>
          <dl>
            ${work.date ? `<div><dt>Date</dt><dd>${escapeHtml(formatDate(work.date))}</dd></div>` : ''}
            ${work.medium ? `<div><dt>Medium</dt><dd>${escapeHtml(work.medium)}</dd></div>` : ''}
            ${work.type ? `<div><dt>Artwork type</dt><dd>${escapeHtml(work.type)}</dd></div>` : ''}
            ${work.dimensions ? `<div><dt>Dimensions</dt><dd>${escapeHtml(work.dimensions)}</dd></div>` : ''}
            ${work.catalogId ? `<div><dt>Catalog</dt><dd>${escapeHtml(work.catalogId)}</dd></div>` : ''}
            ${work.identity ? `<div><dt>Identity</dt><dd>${escapeHtml(work.identity)}</dd></div>` : ''}
            ${work.duration ? `<div><dt>Duration</dt><dd>${escapeHtml(work.duration)}</dd></div>` : ''}
            ${workExternalUrl(work) ? `<div><dt>Source</dt><dd><a class="metadata-source-link" href="${escapeHtml(sourceLaunchUrl(work))}">${escapeHtml(sourceLaunchLabel(work))} ↗</a></dd></div>` : ''}
            ${work.projects?.length ? `<div><dt>Project</dt><dd>${escapeHtml(work.projects.join(', '))}</dd></div>` : ''}
            ${work.tags?.length ? `<div><dt>Tags</dt><dd>${escapeHtml(work.tags.map(tag => `#${tag}`).join(' '))}</dd></div>` : ''}
          </dl>
          ${work.description ? `<section class="work-wiki-card"><span>About this work</span><p>${escapeHtml(work.description)}</p></section>` : ''}
          ${work.critique ? `<section class="critique-card"><span>AI critique</span><p>${escapeHtml(work.critique)}</p></section>` : ''}
          ${work.text ? `<section class="transcription-card"><span>${isPoetryWork(work) ? 'Transcription' : 'Writing'}</span><p>${escapeHtml(work.text)}</p></section>` : ''}
          </div>
        </div></section>
      </div></div>
    </div>
    <div class="card-slider-wrap"><span>Next</span><div class="card-slider" role="slider" tabindex="0" aria-label="Pull left for next or right for previous" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="0" data-card-slider><span class="card-slider-track"><i data-slider-progress></i><b data-slider-thumb></b></span></div><span>Previous</span></div>
    <p class="swipe-hint">${workExternalUrl(work) ? 'Hold the preview to open its source app' : work.media?.mimeType === 'application/pdf' ? 'Hold to expand · swipe sideways to browse' : 'Tap the card to turn it over'}</p>
  </article>`;
  const stage = document.querySelector('[data-swipe-stage]');
  const cardMotion = document.querySelector('[data-card-motion]');
  const card = document.querySelector('[data-detail-card]');
  hydratePdfReader(work);
  const detailFront = document.querySelector('.detail-front');
  const detailImage = detailFront?.querySelector(':scope > img');
  if (detailFront && detailImage) {
    const lens = document.createElement('span');
    lens.className = 'detail-magnifier';
    const lensImage = document.createElement('img');
    lensImage.alt = '';
    lensImage.src = detailImage.currentSrc || detailImage.src;
    lens.appendChild(lensImage);
    detailFront.appendChild(lens);
    const updateArtInspection = event => {
      if (event.pointerType === 'touch' || !detailImage.naturalWidth || !detailImage.naturalHeight) return;
      const frame = detailFront.getBoundingClientRect();
      const normalizedX = Math.max(-1, Math.min(1, ((event.clientX - frame.left) / frame.width - .5) * 2));
      const normalizedY = Math.max(-1, Math.min(1, ((event.clientY - frame.top) / frame.height - .5) * 2));
      detailImage.style.transform = `perspective(1200px) rotateX(${-normalizedY * 5}deg) rotateY(${normalizedX * 5}deg) scale(.985)`;

      const containScale = Math.min(frame.width / detailImage.naturalWidth, frame.height / detailImage.naturalHeight);
      const shownWidth = detailImage.naturalWidth * containScale;
      const shownHeight = detailImage.naturalHeight * containScale;
      const shownLeft = (frame.width - shownWidth) / 2;
      const shownTop = (frame.height - shownHeight) / 2;
      const imageX = event.clientX - frame.left - shownLeft;
      const imageY = event.clientY - frame.top - shownTop;
      if (imageX < 0 || imageY < 0 || imageX > shownWidth || imageY > shownHeight) {
        lens.classList.remove('is-visible');
        return;
      }
      const radius = Math.min(156.4, Math.max(108.8, frame.width * .1275));
      const zoom = 2.25;
      lens.style.setProperty('--lens-size', `${radius * 2}px`);
      lens.style.left = `${shownLeft + imageX - radius}px`;
      lens.style.top = `${shownTop + imageY - radius}px`;
      lensImage.style.width = `${shownWidth * zoom}px`;
      lensImage.style.height = `${shownHeight * zoom}px`;
      lensImage.style.left = `${radius - imageX * zoom}px`;
      lensImage.style.top = `${radius - imageY * zoom}px`;
      lens.classList.add('is-visible');
    };
    detailFront.addEventListener('pointermove', updateArtInspection);
    detailFront.addEventListener('pointerleave', () => {
      detailImage.style.transform = '';
      lens.classList.remove('is-visible');
    });
  }
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
  clearInterval(artHeroCycleTimer);
  artHeroCycleTimer = null;
  const publicShell = document.querySelector('.public-section-shell');
  const hoverPreview = document.querySelector('[data-hover-preview]');
  const heroTitle = document.querySelector('[data-preview-title]');
  const artHeroWorks = activeType === 'Images'
    ? (gallery?.works || []).filter(work => isArtWork(work) && Boolean(work.image || (String(work.media?.mimeType || '').startsWith('image/') && workMediaSource(work))))
    : [];
  const randomizeArtMotion = preview => {
    if (!preview) return;
    const direction = Math.random() < .5 ? -1 : 1;
    const verticalDirection = Math.random() < .5 ? -1 : 1;
    preview.style.setProperty('--hero-pan-start-x', `${direction * -7}%`);
    preview.style.setProperty('--hero-pan-mid-x', `${direction * 1.5}%`);
    preview.style.setProperty('--hero-pan-end-x', `${direction * 8}%`);
    preview.style.setProperty('--hero-pan-start-y', `${verticalDirection * -3 - 4}px`);
    preview.style.setProperty('--hero-pan-mid-y', `${verticalDirection * 5 - 8}px`);
    preview.style.setProperty('--hero-pan-end-y', `${verticalDirection * 11 - 10}px`);
    preview.style.setProperty('--hero-zoom-start', String(1.035 + Math.random() * .025));
    preview.style.setProperty('--hero-zoom-mid', String(1.12 + Math.random() * .035));
    preview.style.setProperty('--hero-zoom-end', String(1.22 + Math.random() * .065));
  };
  let artHeroIndex = Math.max(0, artHeroWorks.findIndex(work => String(work.id) === String(publicShell?.dataset.heroWork)));
  const showArtHero = (work, { immediate = false } = {}) => {
    if (!hoverPreview || !work || publicShell?.classList.contains('has-open-catalogue')) return;
    const replace = () => {
      randomizeArtMotion(hoverPreview);
      hoverPreview.innerHTML = artHeroMarkup(work);
      if (heroTitle) {
        heroTitle.textContent = work.title || 'Untitled';
        void heroTitle.offsetWidth;
        heroTitle.classList.add('is-visible');
      }
      hoverPreview.setAttribute('aria-label', `Featured artwork: ${work.title || 'Untitled'}`);
      hoverPreview.setAttribute('aria-hidden', 'false');
      void hoverPreview.offsetWidth;
      hoverPreview.classList.add('is-visible');
      publicShell?.classList.add('has-cycling-hero');
      if (publicShell) publicShell.dataset.heroWork = String(work.id || '');
    };
    if (immediate || !hoverPreview.childElementCount) return replace();
    hoverPreview.classList.remove('is-visible');
    heroTitle?.classList.remove('is-visible');
    setTimeout(replace, 420);
  };
  const startArtHeroCycle = () => {
    clearInterval(artHeroCycleTimer);
    if (!artHeroWorks.length || !hoverPreview || publicShell?.classList.contains('has-open-catalogue')) return;
    showArtHero(artHeroWorks[artHeroIndex % artHeroWorks.length], { immediate: true });
    artHeroCycleTimer = setInterval(() => {
      artHeroIndex = (artHeroIndex + 1) % artHeroWorks.length;
      showArtHero(artHeroWorks[artHeroIndex]);
    }, 6500);
  };
  document.querySelectorAll('[data-disclosure]').forEach(button => button.addEventListener('click', () => {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel) return;
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    if (button.classList.contains('public-catalogue-toggle')) button.setAttribute('aria-label', expanded ? 'Open complete card catalogue' : 'Close complete card catalogue');
    panel.hidden = expanded;
    const disclosure = panel.closest('.public-card-catalogue, .public-tag-cloud');
    disclosure?.classList.toggle('is-open', !expanded);
    if (disclosure?.classList.contains('public-card-catalogue-years')) {
      document.querySelector('.public-section-shell')?.classList.toggle('has-open-catalogue', !expanded);
      publicShell?.classList.toggle('has-cycling-hero', expanded);
      clearInterval(artHeroCycleTimer);
      if (expanded) {
        const preview = document.querySelector('[data-hover-preview]');
        if (preview) { preview.replaceChildren(); preview.classList.remove('is-visible'); preview.removeAttribute('data-preview-work'); preview.setAttribute('aria-hidden', 'true'); }
        if (heroTitle) { heroTitle.textContent = ''; heroTitle.classList.remove('is-visible'); }
        startArtHeroCycle();
      } else if (hoverPreview) { hoverPreview.replaceChildren(); hoverPreview.classList.remove('is-visible'); }
    }
  }));
  document.querySelector('[data-version-code]')?.remove();
  const versionCode = document.createElement('span');
  versionCode.className = 'version-code';
  versionCode.dataset.versionCode = '';
  versionCode.textContent = `${DOCENT_BUILD} · ${gallery?.payloadVersion || 'G?'}`;
  versionCode.title = `Archive interface ${DOCENT_BUILD}; catalogue payload ${gallery?.payloadVersion || 'legacy'}`;
  document.body.appendChild(versionCode);
  hydratePdfCardCovers();
  document.querySelectorAll('[data-import]').forEach(button => button.addEventListener('click', () => packageInput.click()));
  document.querySelectorAll('[data-dropbox]').forEach(button => button.addEventListener('click', () => syncDropbox().catch(error => alert(error.message))));
  document.querySelectorAll('[data-work]').forEach(button => button.addEventListener('click', () => {
    const work = gallery.works.find(candidate => String(candidate.id) === button.dataset.work);
    if (work) {
      galleryScrollY = window.scrollY; detailExpanded = false; detailSide = 'image'; renderWork(work);
      hydratePublicWork(work).then(complete => {
        if (complete !== work) renderWork(complete);
      }).catch(() => {});
    }
  }));
  const startCardVideo = button => {
    const videoId = button?.dataset.hoverVideo;
    const art = button?.querySelector('.home-shelf-art');
    if (!videoId || !art || art.querySelector('iframe')) return;
    const frame = document.createElement('iframe');
    frame.className = 'card-hover-video';
    frame.title = '';
    frame.tabIndex = -1;
    frame.allow = 'autoplay; encrypted-media';
    frame.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1&autoplay=1&mute=1&controls=0&loop=1&playlist=${encodeURIComponent(videoId)}&playsinline=1&rel=0&modestbranding=1&origin=${encodeURIComponent(location.origin)}`;
    const onPlayerMessage = event => {
      if (event.source !== frame.contentWindow) return;
      let message = event.data;
      try { if (typeof message === 'string') message = JSON.parse(message); } catch { return; }
      if (message?.event === 'onStateChange' && Number(message.info) === 1) frame.classList.add('is-ready');
    };
    frame._playerMessageHandler = onPlayerMessage;
    window.addEventListener('message', onPlayerMessage);
    frame.addEventListener('load', () => {
      const command = func => frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');
      frame.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: videoId }), '*');
      command('mute');
      command('playVideo');
      setTimeout(() => command('playVideo'), 900);
    }, { once: true });
    art.appendChild(frame);
    button.classList.add('is-video-playing');
  };
  const stopCardVideo = button => {
    const frame = button?.querySelector('.card-hover-video');
    if (frame?._playerMessageHandler) window.removeEventListener('message', frame._playerMessageHandler);
    frame?.remove();
    button?.classList.remove('is-video-playing');
  };
  document.querySelectorAll('[data-hover-video]').forEach(button => {
    button.addEventListener('pointerenter', () => startCardVideo(button));
    button.addEventListener('pointerleave', () => stopCardVideo(button));
    button.addEventListener('focus', () => startCardVideo(button));
    button.addEventListener('blur', () => stopCardVideo(button));
  });
  const showHoverPreview = button => {
    if (!hoverPreview || !button || !publicShell?.classList.contains('has-open-catalogue')) return;
    const work = gallery.works.find(candidate => String(candidate.id) === button.dataset.work);
    if (!work) return;
    if (hoverPreview.dataset.previewWork === String(work.id) && hoverPreview.classList.contains('is-visible')) return;
    clearTimeout(hoverPreview._swapTimer);
    const reveal = () => {
      randomizeArtMotion(hoverPreview);
      hoverPreview.innerHTML = artHeroMarkup(work);
      if (heroTitle) {
        heroTitle.textContent = work.title || 'Untitled';
        void heroTitle.offsetWidth;
        heroTitle.classList.add('is-visible');
      }
      hoverPreview.dataset.previewWork = String(work.id);
      hoverPreview.setAttribute('aria-label', `Preview of ${work.title || 'artwork'}`);
      hoverPreview.setAttribute('aria-hidden', 'false');
      void hoverPreview.offsetWidth;
      hoverPreview.classList.add('is-visible');
    };
    if (hoverPreview.childElementCount) {
      hoverPreview.classList.remove('is-visible');
      heroTitle?.classList.remove('is-visible');
      hoverPreview._swapTimer = setTimeout(reveal, 420);
    } else reveal();
  };
  publicShell?.addEventListener('pointerover', event => showHoverPreview(event.target.closest('[data-work]')));
  publicShell?.addEventListener('focusin', event => showHoverPreview(event.target.closest('[data-work]')));
  const artTitle = activeType === 'Images' ? document.querySelector('.public-section-intro h1') : null;
  if (artTitle) {
    artTitle.style.fontFamily = ART_DISPLAY_FONTS[artTitleFontIndex];
    artTitle.dataset.fontIndex = String(artTitleFontIndex);
  }
  let lastArtPointerTime = 0;
  let lastArtFont = artTitleFontIndex;
  artTitle?.addEventListener('pointermove', event => {
    const elapsed = Math.max(1, event.timeStamp - lastArtPointerTime);
    lastArtPointerTime = event.timeStamp;
    const speed = Math.hypot(event.movementX, event.movementY) / elapsed;
    if (speed < .72 || artTitle.classList.contains('is-coin-spinning')) return;
    let nextFont = Math.floor(Math.random() * ART_DISPLAY_FONTS.length);
    if (nextFont === lastArtFont) nextFont = (nextFont + 1) % ART_DISPLAY_FONTS.length;
    clearTimeout(artTitle._fontSwapTimer);
    artTitle.classList.add('is-coin-spinning');
    artTitle._fontSwapTimer = setTimeout(() => {
      lastArtFont = nextFont;
      artTitleFontIndex = nextFont;
      artTitle.dataset.fontIndex = String(nextFont);
      artTitle.style.fontFamily = ART_DISPLAY_FONTS[nextFont];
    }, 450);
    artTitle.addEventListener('animationend', () => {
      artTitle.classList.remove('is-coin-spinning');
    }, { once: true });
  });
  startArtHeroCycle();
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
  document.querySelectorAll('[data-open-profile]').forEach(button => button.addEventListener('click', () => { activeType = 'Profile'; activeProject = 'All'; activeTag = 'All'; activeSubject = 'All'; searchQuery = ''; renderGallery(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  const citationViewer = document.querySelector('[data-citation-viewer]');
  const closeCitation = () => { citationViewer?.classList.remove('is-open'); citationViewer?.setAttribute('aria-hidden', 'true'); };
  document.querySelectorAll('[data-profile-citation]').forEach(button => button.addEventListener('click', () => {
    const work = gallery.works.find(candidate => String(candidate.id) === button.dataset.profileCitation);
    if (!work || !citationViewer) return;
    citationViewer.querySelector('[data-citation-art]').innerHTML = workCardVisual(work);
    citationViewer.querySelector('[data-citation-title]').textContent = work.title;
    citationViewer.classList.add('is-open');
    citationViewer.setAttribute('aria-hidden', 'false');
  }));
  citationViewer?.querySelectorAll('[data-citation-close]').forEach(button => button.addEventListener('click', closeCitation));
  document.querySelectorAll('[data-home]').forEach(button => button.addEventListener('click', () => { if (gallery) { activeType = 'All'; activeProject = 'All'; activeTag = 'All'; activeSubject = 'All'; activeYear = 'All'; activePublicAge = 'All'; activePublicCollection = ''; searchQuery = ''; renderGallery(); } window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  document.querySelectorAll('[data-home-entrance]').forEach(button => button.addEventListener('click', () => {
    activeType = button.dataset.homeEntrance;
    activeProject = 'All'; activeTag = 'All'; activeSubject = 'All'; activeYear = 'All'; activePublicAge = 'All'; activePublicCollection = ''; searchQuery = '';
    renderGallery(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
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
    activeSubject = 'All';
    activeYear = 'All';
    activePublicAge = 'All';
    activePublicCollection = '';
    searchQuery = '';
    artMenuOpen = false;
    renderGallery();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  document.querySelector('[data-search]')?.addEventListener('input', event => {
    const value = event.target.value;
    const cursor = event.target.selectionStart ?? value.length;
    clearTimeout(searchRenderTimer);
    searchRenderTimer = setTimeout(() => {
      searchQuery = value;
      renderGallery();
      const input = document.querySelector('[data-search]');
      input?.focus();
      input?.setSelectionRange(cursor, cursor);
    }, value ? 140 : 0);
  });
  document.querySelectorAll('[data-year]').forEach(button => button.addEventListener('click', () => {
    activeYear = button.dataset.year;
    renderGallery();
  }));
  document.querySelectorAll('[data-public-age]').forEach(button => button.addEventListener('click', () => {
    activePublicAge = button.dataset.publicAge;
    activePublicCollection = '';
    activeYear = 'All';
    renderGallery();
  }));
  document.querySelectorAll('[data-public-collection]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault();
    activePublicCollection = button.dataset.publicCollection;
    activeYear = 'All'; searchQuery = '';
    renderGallery(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  document.querySelector('[data-close-public-collection]')?.addEventListener('click', event => {
    event.preventDefault();
    activePublicCollection = '';
    activeYear = 'All'; searchQuery = '';
    renderGallery(); window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.querySelectorAll('[data-index-term]').forEach(button => button.addEventListener('click', () => {
    searchQuery = button.dataset.indexTerm;
    activeProject = 'All'; activeTag = 'All'; activeSubject = 'All';
    renderGallery();
  }));
  document.querySelectorAll('[data-rail-scroll]').forEach(button => button.addEventListener('click', () => {
    const track = document.querySelector(`[data-rail-track="${button.dataset.rail}"]`);
    track?.scrollBy({ left: (button.dataset.railScroll === 'forward' ? 1 : -1) * Math.max(320, track.clientWidth * .82), behavior: 'smooth' });
  }));
  const cyclingSearch = document.querySelector('[data-cycling-search]');
  if (cyclingSearch && !cyclingSearch.value) {
    const prompts = activeType === 'Images'
      ? ['self portraits', 'sketches from 2023', 'final character designs', 'Batman drawings', 'digital art about identity']
      : activeType === 'Video'
        ? ['animations', 'short films', 'video work from 2022', 'performances']
        : ['songs about faith', 'live recordings', 'music from 2020', 'voice experiments'];
    let promptIndex = 0;
    let characterIndex = 0;
    let deleting = false;
    let pauseTicks = 0;
    searchPromptTimer = setInterval(() => {
      if (!cyclingSearch.isConnected || cyclingSearch.value) return;
      const prompt = prompts[promptIndex];
      if (pauseTicks) { pauseTicks -= 1; return; }
      characterIndex += deleting ? -1 : 1;
      cyclingSearch.placeholder = prompt.slice(0, Math.max(0, characterIndex));
      if (!deleting && characterIndex >= prompt.length) { deleting = true; pauseTicks = 12; }
      if (deleting && characterIndex <= 0) { deleting = false; promptIndex = (promptIndex + 1) % prompts.length; pauseTicks = 3; }
    }, 85);
  }
  document.querySelectorAll('[data-project]').forEach(button => button.addEventListener('click', () => { activeProject = button.dataset.project; renderGallery(); }));
  document.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => { activeType = button.dataset.type; renderGallery(); }));
  document.querySelectorAll('[data-tag]').forEach(button => button.addEventListener('click', () => { activeTag = button.dataset.tag; renderGallery(); }));
  document.querySelectorAll('[data-subject]').forEach(button => button.addEventListener('click', () => { activeSubject = button.dataset.subject; renderGallery(); }));
  document.querySelector('[data-clear-filters]')?.addEventListener('click', () => { activeProject = 'All'; activeTag = 'All'; activeSubject = 'All'; activeYear = 'All'; searchQuery = ''; renderGallery(); });
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

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=133', { updateViaCache: 'none' }).then(registration => registration.update()).catch(() => {});

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

const pageParameters = new URLSearchParams(location.search);
const previewMode = pageParameters.get('preview') === '1';
const previewSection = pageParameters.get('section');
if (['Images', 'Video', 'Music'].includes(previewSection)) activeType = previewSection;
const hostnameSection = {
  'art.joshmcgary.com': 'Images',
  'video.joshmcgary.com': 'Video',
  'audio.joshmcgary.com': 'Music',
  'thoughts.joshmcgary.com': 'Thoughts'
}[location.hostname];
if (hostnameSection) activeType = hostnameSection;
activePublicCollection = pageParameters.get('collection') || '';
const loadBundledGallery = async () => {
  const response = await fetch('./preview-gallery.json?v=117', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Preview catalogue returned ${response.status}.`);
  let preview = await response.json();
  if (Array.isArray(preview.previewShards) && preview.previewShards.length) {
    const shardPayloads = await Promise.all(preview.previewShards.map(async descriptor => {
      const shardResponse = await fetch(`./preview-shards/${encodeURIComponent(descriptor.file)}`, { cache: 'no-store' });
      if (!shardResponse.ok) throw new Error(`Preview segment ${descriptor.id} returned ${shardResponse.status}.`);
      return shardResponse.json();
    }));
    preview = { ...preview, works: shardPayloads.flatMap(shard => shard.works || []) };
  }
  if (!validPackage(preview)) throw new Error('The bundled public catalogue is incomplete.');
  return preview;
};
const loadPublicCorpus = async () => {
  const response = await fetch(`${PUBLIC_CORPUS_ENDPOINT}/manifest.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Public catalogue returned ${response.status}.`);
  const manifest = await response.json();
  if (!validManifest(manifest)) throw new Error('The public catalogue manifest is incomplete.');
  const indexPath = String(manifest.index?.path || '/The_Docent/index.json').replace(/^\/The_Docent\//, '');
  const indexResponse = await fetch(`${PUBLIC_CORPUS_ENDPOINT}/${indexPath}`, { cache: 'no-store' });
  if (!indexResponse.ok) throw new Error(`Public catalogue index returned ${indexResponse.status}.`);
  const index = await indexResponse.json();
  if (!validPackage(index)) throw new Error('The public catalogue index is incomplete.');
  return {
    ...manifest,
    schema: 'the-archivist.docent-gallery',
    works: index.works
  };
};
const nextPublicPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const renderPublicHomeProgressively = async completeGallery => {
  let allWorks = completeGallery.works || [];
  const stagedWorks = [];
  const stagedIds = new Set();
  const stages = [
    work => isArtWork(work),
    work => isVideoWork(work),
    work => isWritingWork(work) || isTheologyWork(work) || isPoetryWork(work),
    () => true
  ];
  for (const includesWork of stages) {
    allWorks.forEach(work => {
      const id = String(work.permanentWorkId || work.id);
      if (!stagedIds.has(id) && includesWork(work)) {
        stagedIds.add(id);
        stagedWorks.push(work);
      }
    });
    gallery = { ...completeGallery, works: [...stagedWorks] };
    renderHome(gallery.works);
    await nextPublicPaint();
  }
};
const hydratePublicWork = async work => {
  if (!work?.shardId || work.image || work.media) return work;
  let shardPromise = publicShardCache.get(work.shardId);
  if (!shardPromise) {
    shardPromise = fetch(`${PUBLIC_CORPUS_ENDPOINT}/shards/${encodeURIComponent(work.shardId)}.json`, { cache: 'force-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`Public catalogue segment ${work.shardId} returned ${response.status}.`);
        return response.json();
      })
      .then(shard => {
        if (!validShard(shard)) throw new Error(`Public catalogue segment ${work.shardId} is incomplete.`);
        return shard;
      });
    publicShardCache.set(work.shardId, shardPromise);
  }
  const shard = await shardPromise;
  const complete = shard.works.find(candidate => String(candidate.id) === String(work.id));
  if (!complete) return work;
  const merged = { ...work, ...complete, order: work.order, shardId: work.shardId };
  gallery.works = gallery.works.map(candidate => String(candidate.id) === String(work.id) ? merged : candidate);
  return merged;
};
const hydrateVisiblePublicCards = () => {
  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const button = entry.target;
    observer.unobserve(button);
    const work = gallery.works.find(candidate => String(candidate.id) === button.dataset.work);
    if (!work || work.image || work.media) return;
    hydratePublicWork(work).then(complete => {
      if (complete === work) return;
      document.querySelectorAll(`[data-work="${CSS.escape(String(work.id))}"] .home-shelf-art`).forEach(art => {
        art.innerHTML = workCardVisual(complete);
      });
    }).catch(() => {});
  }), { rootMargin: '240px' });
  document.querySelectorAll('.home-shelf-card[data-work]').forEach(button => {
    const work = gallery.works.find(candidate => String(candidate.id) === button.dataset.work);
    if (work?.shardId && !work.image && !work.media) observer.observe(button);
  });
};
if (previewMode) app.innerHTML = '<main class="empty"><p class="eyebrow">Josh McGary</p><h1>Opening the archive…</h1></main>';

const publicArchiveHost = /(^|\.)joshmcgary\.com$/i.test(location.hostname);
const progressivePublicHome = publicArchiveHost && activeType === 'All';
gallery = previewMode || publicArchiveHost ? null : await readStoredGallery();
if (progressivePublicHome) renderHome([]);
if (previewMode || !gallery) {
  try {
    gallery = publicArchiveHost ? await loadPublicCorpus() : await loadBundledGallery();
  } catch (error) {
    try {
      gallery = await loadBundledGallery();
    } catch (fallbackError) {
      app.innerHTML = `<main class="empty"><p class="eyebrow">Preview error</p><h1>Unable to open the archive</h1><p class="intro">${escapeHtml(fallbackError.message || error.message)}</p></main>`;
    }
  }
}
if (gallery && progressivePublicHome) await renderPublicHomeProgressively(gallery);
else if (gallery) {
  renderGallery();
}
else if (!previewMode) renderEmpty();
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
