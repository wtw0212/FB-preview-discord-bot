const cheerio = require('cheerio');
const { URL } = require('node:url');

const FALLBACK_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FACEBOOK_REGEX =
  /https?:\/\/(?:[\w-]+\.)*(?:facebook\.com|fb\.watch)\/[\w\d/?=&#%:;@.,_~!+\-]*[\w\d/=?&#%:;@._~+\-]/gi;
const FACEBOOK_HOSTS = ['facebook.com', 'fb.com', 'fb.watch'];
const DEFAULT_TIMEOUT_MS = 10000;
const TRAILING_PUNCTUATION_REGEX = /[)>.,!?:;'"\]]+$/;

const DESCRIPTION_SELECTORS = [
  'meta[property="og:description"]',
  'meta[name="og:description"]',
  'meta[name="description"]',
  'meta[property="twitter:description"]',
];

const TITLE_SELECTORS = [
  'meta[property="og:title"]',
  'meta[name="og:title"]',
  'meta[property="twitter:title"]',
];

const SITE_NAME_SELECTORS = [
  'meta[property="og:site_name"]',
  'meta[name="og:site_name"]',
];

const IMAGE_SELECTORS = [
  { selector: 'meta[property="og:image:secure_url"]' },
  { selector: 'meta[property="og:image:url"]' },
  { selector: 'meta[property="og:image"]' },
  { selector: 'meta[name="og:image"]' },
  { selector: 'meta[property="twitter:image"]' },
  { selector: 'link[rel="image_src"]', attr: 'href' },
];

function extractFacebookLinks(text) {
  if (!text) {
    return [];
  }

  const matches = text.match(FACEBOOK_REGEX) || [];
  const normalized = matches
    .map((raw) => raw.replace(TRAILING_PUNCTUATION_REGEX, ''))
    .map((raw) => normalizeFacebookUrl(raw))
    .filter(Boolean);

  return Array.from(new Set(normalized));
}

async function fetchFacebookMetadata(url, options = {}) {
  const headers = buildHeaders(options.userAgent);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || DEFAULT_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request to Facebook timed out for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch Facebook URL ${url} (status ${response.status})`);
  }

  const html = await response.text();
  return {
    url,
    ...parseOpenGraph(html, url),
  };
}

function parseOpenGraph(html, pageUrl) {
  const $ = cheerio.load(html);
  const title = cleanText(
    firstMeta($, TITLE_SELECTORS.map((selector) => ({ selector }))) || $('title').text() || 'Facebook link'
  );
  const description = cleanText(firstMeta($, DESCRIPTION_SELECTORS.map((selector) => ({ selector }))) || '');
  const siteName =
    cleanText(firstMeta($, SITE_NAME_SELECTORS.map((selector) => ({ selector }))) || 'Facebook') || 'Facebook';
  const type = cleanText(firstMeta($, [{ selector: 'meta[property="og:type"]' }]) || '');
  const image = resolveToAbsolute(firstMeta($, IMAGE_SELECTORS), pageUrl);

  return {
    title: title || 'Facebook link',
    description: description || null,
    siteName,
    type: type || null,
    image: image || null,
  };
}

function firstMeta($, selectors) {
  for (const { selector, attr = 'content' } of selectors) {
    const value = $(selector).attr(attr);
    if (value) {
      return value;
    }
  }
  return null;
}

function cleanText(value) {
  if (!value) {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function resolveToAbsolute(candidate, baseUrl) {
  if (!candidate) {
    return null;
  }

  try {
    return new URL(candidate, baseUrl).toString();
  } catch (error) {
    return null;
  }
}

function normalizeFacebookUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);

    if (parsed.hostname === 'l.facebook.com' && parsed.searchParams.has('u')) {
      const forwardedParam = parsed.searchParams.get('u');
      const forwarded = (() => {
        try {
          return decodeURIComponent(forwardedParam);
        } catch (error) {
          return forwardedParam;
        }
      })();
      return normalizeFacebookUrl(forwarded);
    }

    if (!isFacebookHostname(parsed.hostname)) {
      return null;
    }

    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    return null;
  }
}

function isFacebookHostname(hostname) {
  return FACEBOOK_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function buildHeaders(userAgent) {
  return {
    'User-Agent': userAgent || FALLBACK_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

module.exports = {
  FACEBOOK_REGEX,
  extractFacebookLinks,
  fetchFacebookMetadata,
};
