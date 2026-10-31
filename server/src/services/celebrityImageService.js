
const { isConfigured, getCloudinary } = require('./cloudinaryService');

const UA =
  'FameVoteSeed/1.0 (Celebrity image importer; contact: site admin)';
const MAX_RETRIES = 3;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const sleepDefault = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SUMMARY_URL = (title) =>
  `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    String(title).replace(/ /g, '_')
  )}`;

function retryDelay(response, attempt, baseDelayMs = 800) {
  const header = response?.headers?.get?.('retry-after');

  if (header) {
    const seconds = Number(header);

    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 30000);
    }

    const date = Date.parse(header);

    if (Number.isFinite(date)) {
      return Math.max(0, Math.min(date - Date.now(), 30000));
    }
  }

  return Math.min(baseDelayMs * 2 ** attempt, 8000);
}

async function fetchWithRetry(url, options = {}, fetchImpl = fetch, deps = {}) {
  const sleep = deps.sleep || sleepDefault;
  const maxRetries = deps.retries ?? deps.maxRetries ?? MAX_RETRIES;
  const timeoutMs = options.timeoutMs;
  const requestOptions = { ...options };
  delete requestOptions.timeoutMs;

  for (let attempt = 0; ; attempt += 1) {
    let response;
    const attemptOptions = { ...requestOptions };
    // Create a fresh timeout signal for each retry; never reuse an aborted signal.
    if (timeoutMs && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      attemptOptions.signal = AbortSignal.timeout(timeoutMs);
    }

    try {
      response = await fetchImpl(url, attemptOptions);
    } catch (error) {
      if (attempt >= maxRetries) throw error;
      await sleep(Math.min(800 * 2 ** attempt, 8000));
      continue;
    }

    const retryable = [429, 500, 502, 503, 504].includes(response.status);

    if (response.ok || !retryable || attempt >= maxRetries) {
      return response;
    }

    await sleep(retryDelay(response, attempt, deps.baseDelayMs));
  }
}

function approvedWikipediaImageUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === 'https:' &&
      ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function approvedCommonsImageUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === 'https:' &&
      url.hostname === 'upload.wikimedia.org'
    );
  } catch {
    return false;
  }
}

function cleanMetadata(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function metadataValue(metadata, key) {
  return cleanMetadata(metadata?.[key]?.value || '');
}

function normalizeName(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Resolves only the Wikipedia article lead image.
 * This intentionally does not search Commons.
 */
async function resolveWikipediaImage(title, fetchImpl = fetch, deps = {}) {
  const response = await fetchWithRetry(
    SUMMARY_URL(title),
    {
      headers: {
        'user-agent': UA,
        accept: 'application/json',
      },
      timeoutMs: 20000,
    },
    fetchImpl,
    deps
  );

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(`Wikipedia image lookup failed (${response.status})`);
  }

  const page = await response.json();

  if (page.type === 'disambiguation') return null;

  const wanted = String(title).replace(/_/g, ' ').trim().toLowerCase();
  const actual = String(page.title || '').replace(/_/g, ' ').trim().toLowerCase();

  if (
    actual &&
    wanted &&
    actual !== wanted &&
    !actual.includes(wanted) &&
    !wanted.includes(actual)
  ) {
    return null;
  }

  let source = page.originalimage?.source || page.thumbnail?.source || null;

  if (source && /\/\d+px-/.test(source)) {
    source = source.replace(/\/\d+px-/, '/960px-');
  }

  if (!source || !approvedWikipediaImageUrl(source)) return null;

  const pageUrl =
    page.content_urls?.desktop?.page ||
    `https://en.wikipedia.org/wiki/${encodeURIComponent(
      String(title).replace(/ /g, '_')
    )}`;

  return {
    source,
    pageUrl,
    title: page.title || title,
  };
}

/**
 * Checks Wikimedia Commons for a matching portrait.
 * Only common reusable licenses are accepted automatically.
 * Review the individual file page before relying on its license.
 */
async function findCommonsPortrait(entry, fetchImpl = fetch, deps = {}) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');

  const params = {
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `"${entry.name}"`,
    gsrlimit: '15',
    redirects: '1',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiextmetadatafilter:
      'LicenseShortName|LicenseUrl|Artist|Credit|Attribution|ImageDescription|ObjectName|NonFree',
  };

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetchWithRetry(
    url.toString(),
    {
      headers: {
        'user-agent': UA,
        accept: 'application/json',
      },
      timeoutMs: 25000,
    },
    fetchImpl,
    deps
  );

  if (!response.ok) {
    throw new Error(`Wikimedia Commons search failed (${response.status})`);
  }

  const data = await response.json();
  const pages = Object.values(data.query?.pages || {});
  const name = normalizeName(entry.name);
  const tokens = name.split(' ').filter((token) => token.length > 1);

  const candidates = pages
    .map((page) => {
      const info = page.imageinfo?.[0];

      if (!info) return null;

      const metadata = info.extmetadata || {};
      const license = metadataValue(metadata, 'LicenseShortName');
      const licenseUrl = metadataValue(metadata, 'LicenseUrl');
      const description = metadataValue(metadata, 'ImageDescription');
      const title = cleanMetadata(page.title || '');
      const searchableText = normalizeName(`${title} ${description}`);
      const matchedTokens = tokens.filter((token) =>
        searchableText.includes(token)
      );

      const clearlyReusable =
        Boolean(license && licenseUrl) &&
        metadata.NonFree?.value !== 'true' &&
        !/\bNC\b|\bND\b|non.?commercial|no.?derivatives|fair use|all rights reserved/i.test(
          license
        ) &&
        (
          /\bCC0\b|public domain|\bCC BY\b|\bCC BY-SA\b|creative commons attribution/i.test(
            license
          )
        );

      const width = Number(info.width || 0);
      const height = Number(info.height || 0);

      // Avoid unrelated people with a partial name match.
      const nameMatches =
        tokens.length > 0 &&
        matchedTokens.length === tokens.length;

      if (
        !info.url ||
        !approvedCommonsImageUrl(info.url) ||
        !clearlyReusable ||
        !nameMatches ||
        width < 250 ||
        height < 250
      ) {
        return null;
      }

      let score = matchedTokens.length * 10;

      if (height >= width) score += 2;

      if (
        /\b(portrait|headshot|press|event|festival|premiere|profile)\b/i.test(
          `${title} ${description}`
        )
      ) {
        score += 3;
      }

      return {
        page,
        info,
        metadata,
        license,
        licenseUrl,
        score,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) return null;

  const chosen = candidates[0];
  const metadata = chosen.metadata;
  const pageTitle = chosen.page.title || '';
  const filePage =
    chosen.info.descriptionurl ||
    `https://commons.wikimedia.org/wiki/${encodeURIComponent(
      pageTitle.replace(/ /g, '_')
    )}`;

  const attribution =
    metadataValue(metadata, 'Attribution') ||
    metadataValue(metadata, 'Artist') ||
    metadataValue(metadata, 'Credit') ||
    'Creator not listed';

  return {
    imageUrl: chosen.info.url,
    pageUrl: filePage,
    title: pageTitle,
    source: 'wikimedia-commons',
    license: chosen.license,
    licenseUrl: chosen.licenseUrl,
    attribution,
  };
}

/**
 * Ordered image lookup: Wikipedia first, then Commons.
 */
async function findPortrait(entry, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const tried = [];

  console.log(`  → Checking Wikipedia: ${entry.wikiTitle || entry.name}`);

  try {
    const wikipedia = await resolveWikipediaImage(
      entry.wikiTitle || entry.name,
      fetchImpl,
      options
    );

    if (wikipedia) {
      console.log('  ✓ Wikipedia lead image found');

      return {
        status: 'found',
        imageUrl: wikipedia.source,
        pageUrl: wikipedia.pageUrl,
        source: 'wikipedia',
        license:
          'Wikipedia article lead image; verify the individual image license',
        licenseUrl: '',
        attribution: `${wikipedia.title} — Wikipedia`,
        tried: ['wikipedia: found'],
      };
    }

    tried.push('wikipedia: no suitable lead image');
    console.log('  – No suitable Wikipedia lead image');
  } catch (error) {
    tried.push(`wikipedia: ${error.message}`);
    console.warn(`  ! Wikipedia lookup failed: ${error.message}`);
  }

  console.log('  → Searching Wikimedia Commons fallback');

  try {
    const commons = await findCommonsPortrait(
      entry,
      fetchImpl,
      options
    );

    if (commons) {
      console.log('  ✓ Matching Commons image found');
      console.log(`  License: ${commons.license}`);

      return {
        status: 'found',
        ...commons,
        tried: [...tried, 'wikimedia-commons: found'],
      };
    }

    tried.push('wikimedia-commons: no suitable reusable match');
    console.log('  – No suitable reusable Commons image');
  } catch (error) {
    tried.push(`wikimedia-commons: ${error.message}`);
    console.warn(`  ! Commons lookup failed: ${error.message}`);
  }

  return {
    status: 'placeholder',
    tried,
  };
}

/**
 * Downloads image bytes into memory only.
 * No portrait image is saved to the local filesystem.
 */
async function download(url, options = {}) {
  const approved =
    approvedWikipediaImageUrl(url) || approvedCommonsImageUrl(url);

  if (!approved) {
    throw new Error('Rejected image URL: HTTPS Wikimedia image host required');
  }

  const fetchImpl = options.fetchImpl || fetch;

  const response = await fetchWithRetry(
    url,
    {
      headers: {
        'user-agent': UA,
        accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8',
      },
      timeoutMs: 40000,
    },
    fetchImpl,
    options
  );

  if (!response.ok) {
    throw new Error(`Image download failed (${response.status})`);
  }

  const contentType = (response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  const ext = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }[contentType];

  if (!ext) {
    throw new Error(
      `Unsupported image type: ${contentType || 'unknown content type'}`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (!buffer.length) throw new Error('Image response was empty');

  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Image exceeds the 10 MB safety limit');
  }

  return { buffer, ext };
}

/**
 * Uploads in-memory image bytes directly to Cloudinary.
 */
function uploadPortrait(buffer, slug) {
  if (!isConfigured()) {
    throw new Error('Cloudinary is not configured');
  }

  return new Promise((resolve, reject) => {
    getCloudinary().uploader
      .upload_stream(
        {
          timeout: 30000,
          folder: 'famevote/celebrities',
          public_id: slug,
          overwrite: true,
          resource_type: 'image',
          transformation: [
            {
              width: 800,
              height: 1000,
              crop: 'fill',
              gravity: 'face:auto',
            },
            {
              quality: 'auto',
              fetch_format: 'auto',
            },
          ],
        },
        (error, result) => {
          if (error) return reject(error);

          if (!result?.secure_url) {
            return reject(new Error('Cloudinary returned no secure image URL'));
          }

          resolve({
            url: result.secure_url,
            publicId: result.public_id,
          });
        }
      )
      .end(buffer);
  });
}

async function fetchAndStorePortrait(title, slug, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const found = await resolveWikipediaImage(title, fetchImpl, deps);

  if (!found) return null;

  const { buffer } = await download(found.source, {
    ...deps,
    fetchImpl,
  });

  const uploaded = await (deps.upload || uploadPortrait)(buffer, slug);

  return {
    ...uploaded,
    credit: found.pageUrl,
    source: 'wikipedia',
    license:
      'Wikipedia article lead image; verify the individual image license',
    attribution: `${found.title} — Wikipedia`,
  };
}

async function verifyUrl(url, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;

  try {
    const response = await fetchImpl(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
    });

    return (
      response.ok &&
      (response.headers.get('content-type') || '')
        .toLowerCase()
        .startsWith('image/')
    );
  } catch {
    return false;
  }
}

const cloudinaryReady = isConfigured;

module.exports = {
  resolveWikipediaImage,
  findCommonsPortrait,
  findPortrait,
  fetchAndStorePortrait,
  download,
  uploadPortrait,
  fetchWithRetry,
  verifyUrl,
  cloudinaryReady,
  approvedWikipediaImageUrl,
  approvedCommonsImageUrl,
};
