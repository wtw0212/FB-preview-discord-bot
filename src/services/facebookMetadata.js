const cheerio = require('cheerio');
const { URL } = require('node:url');

// 使用更新的 User-Agent，模擬真實瀏覽器
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
];
const FALLBACK_USER_AGENT = USER_AGENTS[0];
const FACEBOOK_REGEX =
  /https?:\/\/(?:[\w-]+\.)*(?:facebook\.com|fb\.watch)\/[\w\d/?=&#%:;@.,_~!+\-]*[\w\d/=?&#%:;@._~+\-]/gi;
const FACEBOOK_HOSTS = ['facebook.com', 'fb.com', 'fb.watch', 'm.facebook.com', 'www.facebook.com'];
const DEFAULT_TIMEOUT_MS = 15000;
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
  // 嘗試將 /share/p/ 短連結轉換為標準格式
  const normalizedUrl = convertShareUrl(url);
  
  // 嘗試多個 User-Agent
  const userAgents = options.userAgent ? [options.userAgent] : USER_AGENTS;
  let lastError;

  for (const userAgent of userAgents) {
    try {
      const result = await attemptFetch(normalizedUrl, userAgent, options.timeout);
      return result;
    } catch (error) {
      lastError = error;
      // 如果是 400 錯誤，嘗試下一個 User-Agent
      if (error.message.includes('status 400') || error.message.includes('status 403')) {
        continue;
      }
      throw error;
    }
  }

  // 如果所有 User-Agent 都失敗，嘗試使用 mobile 版本的 URL
  if (lastError && lastError.message.includes('status 4')) {
    try {
      const mobileUrl = convertToMobileUrl(normalizedUrl);
      if (mobileUrl !== normalizedUrl) {
        return await attemptFetch(mobileUrl, FALLBACK_USER_AGENT, options.timeout);
      }
    } catch (mobileError) {
      // 忽略 mobile 版本的錯誤，返回原始錯誤
    }
  }

  throw lastError;
}

// 將 /share/p/ 或 /share/v/ 連結轉換為標準 post 連結
function convertShareUrl(url) {
  try {
    const parsed = new URL(url);
    const shareMatch = parsed.pathname.match(/\/share\/[pv]\/([^/?]+)/);
    if (shareMatch) {
      // 保持原始 URL，但確保使用 www 版本
      parsed.hostname = 'www.facebook.com';
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

// 轉換為 mobile 版本的 URL
function convertToMobileUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'www.facebook.com') {
      parsed.hostname = 'm.facebook.com';
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

async function attemptFetch(url, userAgent, timeout) {
  const headers = buildHeaders(userAgent);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout || DEFAULT_TIMEOUT_MS);

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
    clearTimeout(timeoutId);
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
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}

module.exports = {
  FACEBOOK_REGEX,
  extractFacebookLinks,
  fetchFacebookMetadata,
};
