/* pixx.io Spotlight Search — Frontend Logic */

// ── DOM Refs ──────────────────────────────────────────────────────────────────
const searchInput    = document.getElementById('searchInput');
const spinner        = document.getElementById('spinner');
const loadingText    = document.getElementById('loadingText');
const clearBtn       = document.getElementById('clearBtn');
const searchBtn      = document.getElementById('searchBtn');
const searchDetails  = document.getElementById('searchDetails');
const filterTags     = document.getElementById('filterTags');
const searchModeBadge= document.getElementById('searchModeBadge');
const explanation    = document.getElementById('explanation');
const resultsSection = document.getElementById('resultsSection');
const resultsHeader  = document.getElementById('resultsHeader');
const resultsGrid    = document.getElementById('resultsGrid');
const noResults      = document.getElementById('noResults');
const emptyState     = document.getElementById('emptyState');
const lightbox       = document.getElementById('lightbox');
const lightboxImg    = document.getElementById('lightboxImg');
const lightboxMeta   = document.getElementById('lightboxMeta');
const loadMoreContainer = document.getElementById('loadMoreContainer');
const loadMoreBtn    = document.getElementById('loadMoreBtn');

// ── State ────────────────────────────────────────────────────────────────────
let currentResults = [];
let currentQuery   = '';
let currentPage    = 1;
let currentTotal   = 0;

// ── Filter label config ───────────────────────────────────────────────────────
const FILTER_CONFIG = {
  query:          { icon: '🔍', label: 'Suche' },
  person_name:    { icon: '👤', label: 'Person' },
  file_type:      { icon: '🗂', label: 'Typ', map: { image: 'Bild', video: 'Video', audio: 'Audio' } },
  file_extension: { icon: '📄', label: 'Format' },
  date_from:      { icon: '📅', label: 'Ab' },
  date_to:        { icon: '📅', label: 'Bis' },
  orientation:    { icon: '📐', label: 'Format', map: { landscape: 'Querformat', portrait: 'Hochformat', square: 'Quadrat' } },
  colorspace:     { icon: '🎨', label: 'Farbraum' },
  rating_min:     { icon: '⭐', label: 'Mind. Bewertung', suffix: '/5' },
  sort_by:        { icon: '↕️', label: 'Sortierung', map: { uploadDate: 'Hochladedatum', rating: 'Bewertung', pixel: 'Auflösung', fileName: 'Dateiname' } },
  semantic:       { icon: '🧠', label: 'Semantisch' },
};

// ── Search ────────────────────────────────────────────────────────────────────
searchInput.addEventListener('input', () => {
  const val = searchInput.value.trim();
  clearBtn.style.display = val ? 'flex' : 'none';
  if (!val) resetUI();
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const val = searchInput.value.trim();
    if (val) performSearch(val);
  } else if (e.key === 'Escape') {
    clearSearch();
  }
});

searchBtn.addEventListener('click', () => {
  const val = searchInput.value.trim();
  if (val) performSearch(val);
});

clearBtn.addEventListener('click', clearSearch);

function clearSearch() {
  searchInput.value = '';
  clearBtn.style.display = 'none';
  resetUI();
  searchInput.focus();
}

function resetUI() {
  searchDetails.style.display = 'none';
  resultsSection.style.display = 'none';
  emptyState.style.display = 'block';
  noResults.style.display = 'none';
  spinner.style.display = 'none';
  loadingText.style.display = 'none';
  loadMoreContainer.style.display = 'none';
  resultsGrid.innerHTML = '';
  currentResults = [];
  currentPage = 1;
  currentTotal = 0;
}

// ── Loading text rotation ─────────────────────────────────────────────────────
const LOADING_STEPS = [
  'Claude analysiert deine Anfrage…',
  'Suche läuft…',
  'Ergebnisse werden geladen…',
];

let loadingInterval = null;

function startLoadingText() {
  let step = 0;
  loadingText.textContent = LOADING_STEPS[0];
  loadingText.style.display = 'inline';
  loadingText.classList.remove('fade-out');

  loadingInterval = setInterval(() => {
    step = (step + 1) % LOADING_STEPS.length;
    loadingText.classList.add('fade-out');
    setTimeout(() => {
      loadingText.textContent = LOADING_STEPS[step];
      loadingText.classList.remove('fade-out');
    }, 200);
  }, 2000);
}

function stopLoadingText() {
  clearInterval(loadingInterval);
  loadingInterval = null;
  loadingText.style.display = 'none';
}

async function performSearch(query, page = 1) {
  if (page === 1) {
    currentQuery = query;
    currentPage = 1;
    resultsGrid.innerHTML = '';
    currentResults = [];
    searchDetails.style.display = 'none';
    resultsSection.style.display = 'none';
    emptyState.style.display = 'none';
    noResults.style.display = 'none';
    loadMoreContainer.style.display = 'none';
  }

  spinner.style.display = 'flex';
  startLoadingText();

  try {
    const resp = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, page }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || 'Server error');
    }

    const data = await resp.json();
    const newResults = data.results || [];
    currentTotal = data.total || 0;
    currentPage = page;
    currentResults = page === 1 ? newResults : [...currentResults, ...newResults];

    if (page === 1) {
      renderSearchDetails(data.search_details);
    }
    renderResults(newResults, page);

  } catch (err) {
    renderError(err.message);
  } finally {
    spinner.style.display = 'none';
    stopLoadingText();
  }
}

// ── Render: Filter Details ─────────────────────────────────────────────────────
function renderSearchDetails(details) {
  if (!details) return;

  const filters = details.filters_used || {};
  const mode    = details.search_mode || 'standard';

  // Mode badge
  searchModeBadge.textContent = mode === 'semantic' ? '🧠 Semantisch' : '🔍 Standard';
  searchModeBadge.style.display = 'inline';

  // Filter tags
  filterTags.innerHTML = '';
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'page_size' || key === 'sort_direction') continue;
    if (key === 'include_previews') continue;

    const cfg = FILTER_CONFIG[key];
    if (!cfg) continue;

    let displayVal = value;
    if (cfg.map && cfg.map[value]) displayVal = cfg.map[value];
    if (key === 'semantic' && value === true) displayVal = 'Aktiviert';
    if (cfg.suffix) displayVal = `${value}${cfg.suffix}`;

    const tag = document.createElement('div');
    tag.className = 'filter-tag';
    tag.innerHTML = `
      <span class="tag-icon">${cfg.icon}</span>
      <span class="tag-key">${cfg.label}:</span>
      <span class="tag-value">${escHtml(String(displayVal))}</span>
    `;
    filterTags.appendChild(tag);
  }

  // Explanation
  if (details.explanation) {
    explanation.textContent = details.explanation;
    explanation.style.display = 'block';
  } else {
    explanation.style.display = 'none';
  }

  searchDetails.style.display = 'block';
}

// ── Render: Results ────────────────────────────────────────────────────────────
function renderResults(newResults, page) {
  resultsSection.style.display = 'block';

  if (!newResults || newResults.length === 0) {
    if (page === 1) {
      noResults.style.display = 'flex';
      resultsHeader.textContent = '';
    }
    loadMoreContainer.style.display = 'none';
    return;
  }

  resultsHeader.innerHTML = `<strong>${currentTotal.toLocaleString('de')}</strong> Ergebnisse gefunden — zeige ${currentResults.length}`;
  noResults.style.display = 'none';

  newResults.forEach((asset) => {
    const card = createAssetCard(asset);
    resultsGrid.appendChild(card);
  });

  // Show "load more" if there are more results
  if (currentResults.length < currentTotal) {
    loadMoreContainer.style.display = 'flex';
  } else {
    loadMoreContainer.style.display = 'none';
  }
}

function createAssetCard(asset) {
  const card = document.createElement('div');
  card.className = 'asset-card';
  card.tabIndex = 0;
  card.setAttribute('aria-label', asset.title);

  // Thumbnail
  const thumbEl = document.createElement('div');
  thumbEl.className = 'card-thumb';

  const typeBadge = document.createElement('span');
  typeBadge.className = 'file-type-badge';
  typeBadge.textContent = (asset.file_extension || asset.file_type || '?').toUpperCase();

  if (asset.proxy_preview_url) {
    const img = document.createElement('img');
    img.className = 'loading';
    img.alt = asset.title;
    img.onload  = () => { img.classList.remove('loading'); img.classList.add('loaded'); placeholder.style.display = 'none'; };
    img.onerror = () => { img.style.display = 'none'; };
    img.src = asset.proxy_preview_url;

    const placeholder = document.createElement('div');
    placeholder.className = 'thumb-placeholder';
    placeholder.innerHTML = fileTypeIcon(asset.file_type);

    thumbEl.appendChild(img);
    thumbEl.appendChild(placeholder);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'thumb-placeholder';
    placeholder.innerHTML = fileTypeIcon(asset.file_type);
    thumbEl.appendChild(placeholder);
  }

  thumbEl.appendChild(typeBadge);

  // Card body
  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.title = asset.title;
  title.textContent = asset.title;

  const meta = document.createElement('div');
  meta.className = 'card-meta';

  if (asset.dimensions) {
    meta.innerHTML += `<span class="meta-item">📐 ${escHtml(asset.dimensions)}</span>`;
  }
  if (asset.file_size) {
    meta.innerHTML += `<span class="meta-item">💾 ${formatBytes(asset.file_size)}</span>`;
  }
  if (asset.rating) {
    meta.innerHTML += `<span class="meta-item">⭐ ${asset.rating}/5</span>`;
  }
  if (asset.upload_date) {
    meta.innerHTML += `<span class="meta-item">📅 ${formatDate(asset.upload_date)}</span>`;
  }

  const keywords = document.createElement('div');
  keywords.className = 'card-keywords';

  const kws = (asset.keywords || []).slice(0, 4);
  kws.forEach(kw => {
    const tag = document.createElement('span');
    tag.className = 'keyword-tag';
    tag.textContent = kw;
    keywords.appendChild(tag);
  });

  body.appendChild(title);
  body.appendChild(meta);
  if (kws.length > 0) body.appendChild(keywords);

  card.appendChild(thumbEl);
  card.appendChild(body);

  // Click → lightbox
  card.addEventListener('click', () => openLightbox(asset));
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openLightbox(asset); });

  return card;
}

// ── Load More ─────────────────────────────────────────────────────────────────
loadMoreBtn.addEventListener('click', () => {
  performSearch(currentQuery, currentPage + 1);
});

// ── Lightbox ───────────────────────────────────────────────────────────────────
function openLightbox(asset) {
  lightboxImg.src = '';
  lightboxImg.alt = asset.title;

  if (asset.proxy_preview_url) {
    lightboxImg.src = asset.proxy_preview_url;
  }

  lightboxMeta.innerHTML = '';

  const metaRows = [
    ['Dateiname', asset.title],
    ['Typ', `${asset.file_type || ''} · ${(asset.file_extension || '').toUpperCase()}`],
    ['Abmessungen', asset.dimensions],
    ['Dateigröße', asset.file_size ? formatBytes(asset.file_size) : null],
    ['Bewertung', asset.rating ? `${'⭐'.repeat(asset.rating)} (${asset.rating}/5)` : null],
    ['Hochgeladen', asset.upload_date ? formatDate(asset.upload_date) : null],
    ['ID', asset.id],
    ['Beschreibung', asset.description],
  ];

  metaRows.forEach(([key, val]) => {
    if (!val) return;
    const row = document.createElement('div');
    row.className = 'lightbox-meta-row';
    row.innerHTML = `
      <span class="lightbox-meta-key">${escHtml(key)}</span>
      <span class="lightbox-meta-value">${escHtml(String(val))}</span>
    `;
    lightboxMeta.appendChild(row);
  });

  // Keywords full list
  if (asset.keywords && asset.keywords.length > 0) {
    const row = document.createElement('div');
    row.className = 'lightbox-meta-row';
    row.style.gridColumn = '1 / -1';
    row.innerHTML = `
      <span class="lightbox-meta-key">Keywords</span>
      <span class="lightbox-meta-value">${escHtml(asset.keywords.join(', '))}</span>
    `;
    lightboxMeta.appendChild(row);
  }

  lightbox.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightbox.style.display = 'none';
  document.body.style.overflow = '';
  lightboxImg.src = '';
}

document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
document.getElementById('lightboxBackdrop').addEventListener('click', closeLightbox);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && lightbox.style.display !== 'none') closeLightbox();
});

// ── Error ─────────────────────────────────────────────────────────────────────
function renderError(msg) {
  resultsSection.style.display = 'block';
  resultsHeader.textContent = '';
  noResults.style.display = 'none';
  loadMoreContainer.style.display = 'none';
  resultsGrid.innerHTML = `
    <div class="error-card">
      <div class="error-icon">⚠</div>
      <div class="error-message">${escHtml(msg)}</div>
      <button class="error-retry-btn" id="errorRetryBtn">Erneut versuchen</button>
    </div>
  `;
  document.getElementById('errorRetryBtn').addEventListener('click', () => {
    if (currentQuery) performSearch(currentQuery);
  });
}

// ── Example queries ───────────────────────────────────────────────────────────
document.querySelectorAll('.example-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const query = chip.dataset.query;
    searchInput.value = query;
    clearBtn.style.display = 'flex';
    performSearch(query);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

function fileTypeIcon(type) {
  switch (type) {
    case 'video': return '🎬';
    case 'audio': return '🎵';
    case 'image': return '🖼';
    default:      return '📄';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
searchInput.focus();
