const cheerio = require('cheerio');
const { URL } = require('node:url');

// 使用多種 User-Agent，包含桌面和手機版本
const USER_AGENTS = [
  // Chrome Desktop
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // Firefox Desktop
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  // Safari Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  // Chrome Mobile
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  // iPhone Safari
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  // Facebook App User-Agent
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/441.0.0.34.110;FBBV/570675778;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.1.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]',
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
  { selector: 'meta[property="twitter:image:src"]' },
  { selector: 'link[rel="image_src"]', attr: 'href' },
];

// 影片相關選擇器
const VIDEO_SELECTORS = [
  { selector: 'meta[property="og:video:secure_url"]' },
  { selector: 'meta[property="og:video:url"]' },
  { selector: 'meta[property="og:video"]' },
  { selector: 'meta[name="twitter:player:stream"]' },
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
  
  // 首先嘗試使用 Facebook oEmbed API（不需要 token 的公開端點）
  try {
    const oembedResult = await fetchOEmbed(normalizedUrl);
    if (oembedResult && (oembedResult.thumbnail_url || oembedResult.html)) {
      return {
        url: normalizedUrl,
        title: oembedResult.author_name || oembedResult.provider_name || 'Facebook',
        description: null,
        siteName: oembedResult.provider_name || 'Facebook',
        type: oembedResult.type || null,
        image: oembedResult.thumbnail_url || null,
        video: null,
        videoWidth: oembedResult.width || null,
        videoHeight: oembedResult.height || null,
        videoType: null,
        isVideo: oembedResult.type === 'video',
      };
    }
  } catch (oembedError) {
    console.warn('[FacebookMetadata] oEmbed failed:', oembedError.message);
  }

  // 嘗試多個 User-Agent（忽略傳入的 userAgent，使用內建列表）
  let lastError;

  for (const userAgent of USER_AGENTS) {
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

// 嘗試使用 Facebook oEmbed API
async function fetchOEmbed(url) {
  const oembedUrl = `https://www.facebook.com/plugins/post/oembed.json/?url=${encodeURIComponent(url)}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  
  try {
    const response = await fetch(oembedUrl, {
      headers: {
        'User-Agent': FALLBACK_USER_AGENT,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    
    if (!response.ok) {
      return null;
    }
    
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
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
  // 加入隨機延遲，避免被識別為機器人
  const delay = Math.floor(Math.random() * 1000) + 500;
  await new Promise(resolve => setTimeout(resolve, delay));

  const headers = buildHeaders(userAgent);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout || DEFAULT_TIMEOUT_MS);

  console.log(`[Debug] Fetching: ${url}`);

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

  console.log(`[Debug] Response status: ${response.status}, Final URL: ${response.url.substring(0, 60)}...`);

  // 如果被重定向到登入頁面，拋出錯誤讓它嘗試下一個 User-Agent
  if (response.url.includes('/login/') || response.url.includes('login.php')) {
    throw new Error(`Redirected to login page for ${url} (status 403)`);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch Facebook URL ${url} (status ${response.status})`);
  }

  const html = await response.text();
  
  // 雙重檢查是否是登入頁面
  if (html.includes('Log into Facebook') && !html.includes('og:description')) {
    throw new Error(`Got login page for ${url} (status 403)`);
  }
  
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
  
  // 取得圖片 - 嘗試多種方式
  let image = resolveToAbsolute(firstMeta($, IMAGE_SELECTORS), pageUrl);
  
  // 如果圖片 URL 包含 Facebook CDN 的限制參數，嘗試從其他地方取得
  if (!image || isFacebookRestrictedImage(image)) {
    // 嘗試從頁面內容中提取圖片
    const altImage = extractImageFromContent($, pageUrl);
    if (altImage) {
      image = altImage;
    }
  }

  // 取得影片資訊
  let video = resolveToAbsolute(firstMeta($, VIDEO_SELECTORS), pageUrl);
  const videoWidth = parseInt(firstMeta($, [{ selector: 'meta[property="og:video:width"]' }]) || '0', 10);
  const videoHeight = parseInt(firstMeta($, [{ selector: 'meta[property="og:video:height"]' }]) || '0', 10);
  const videoType = firstMeta($, [{ selector: 'meta[property="og:video:type"]' }]);

  // 判斷是否為影片貼文 - 需要更嚴格的判斷
  // og:type 為 video.other 不一定是真的影片，需要有實際的影片 URL 或特定的影片路徑
  const hasVideoUrl = !!video;
  const isVideoPath = pageUrl.includes('/videos/') || 
    pageUrl.includes('/watch/') || 
    pageUrl.includes('/watch?') ||    // /watch?v= 格式
    pageUrl.includes('/reel/') || 
    pageUrl.includes('fb.watch') ||
    pageUrl.includes('/share/v/') ||  // /share/v/ 是影片分享連結
    pageUrl.includes('/share/r/');    // /share/r/ 是 Reels 分享連結
  
  const isVideo = hasVideoUrl || isVideoPath;

  // 如果是影片但沒有取得影片 URL，嘗試從頁面內容提取
  if (isVideo && !video) {
    video = extractVideoFromContent($);
  }

  // 如果還是沒有圖片，嘗試從影片縮圖提取
  if (!image && isVideo) {
    image = extractImageFromContent($, pageUrl);
  }

  return {
    title: title || 'Facebook link',
    description: description || null,
    siteName,
    type: type || null,
    image: image || null,
    video: video || null,
    videoWidth: videoWidth || null,
    videoHeight: videoHeight || null,
    videoType: videoType || null,
    isVideo,
  };
}

// 檢查是否為 Facebook 限制的圖片（通常是預設圖片或空白圖片）
function isFacebookRestrictedImage(imageUrl) {
  if (!imageUrl) return true;
  
  // 常見的 Facebook 預設/限制圖片特徵
  const restrictedPatterns = [
    'safe_image.php',
    'platform-lookaside.fbsbx.com',
    '/images/icons/',
    'rsrc.php',
    'static.xx.fbcdn.net/rsrc',
  ];
  
  return restrictedPatterns.some(pattern => imageUrl.includes(pattern));
}

// 嘗試從頁面內容中提取圖片
function extractImageFromContent($, pageUrl) {
  // 嘗試從 JSON-LD 中提取
  const jsonLdScripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < jsonLdScripts.length; i++) {
    try {
      const jsonText = $(jsonLdScripts[i]).html();
      if (jsonText) {
        const json = JSON.parse(jsonText);
        if (json.image) {
          const img = Array.isArray(json.image) ? json.image[0] : json.image;
          if (typeof img === 'string') {
            return resolveToAbsolute(img, pageUrl);
          } else if (img && img.url) {
            return resolveToAbsolute(img.url, pageUrl);
          }
        }
        if (json.thumbnailUrl) {
          return resolveToAbsolute(json.thumbnailUrl, pageUrl);
        }
      }
    } catch {
      // 忽略 JSON 解析錯誤
    }
  }

  // 嘗試從頁面中的高解析度圖片提取
  const imgElements = $('img[data-src], img[src*="scontent"]');
  for (let i = 0; i < imgElements.length; i++) {
    const src = $(imgElements[i]).attr('data-src') || $(imgElements[i]).attr('src');
    if (src && src.includes('scontent') && !isFacebookRestrictedImage(src)) {
      return resolveToAbsolute(src, pageUrl);
    }
  }

  // 嘗試從內嵌的 JavaScript 資料中提取圖片
  const scripts = $('script').toArray();
  for (const script of scripts) {
    const content = $(script).html() || '';
    
    // 尋找 scontent CDN 圖片 URL
    const imageMatches = content.match(/https?:\\\/\\\/scontent[^"'\\]+\.(?:jpg|jpeg|png|webp)/gi);
    if (imageMatches && imageMatches.length > 0) {
      try {
        // 解碼 escaped URL
        const decodedUrl = imageMatches[0].replace(/\\\//g, '/');
        if (!isFacebookRestrictedImage(decodedUrl)) {
          return decodedUrl;
        }
      } catch {
        // 忽略解碼錯誤
      }
    }
  }

  return null;
}

// 嘗試從頁面內容中提取影片
function extractVideoFromContent($) {
  const scripts = $('script').toArray();
  
  for (const script of scripts) {
    const content = $(script).html() || '';
    
    // 尋找影片 URL 模式
    const videoPatterns = [
      // Facebook video CDN
      /https?:\\\/\\\/video[^"'\\]+\.mp4[^"'\\]*/gi,
      // scontent video
      /https?:\\\/\\\/scontent[^"'\\]+\.mp4[^"'\\]*/gi,
      // fbcdn video
      /https?:\\\/\\\/[^"'\\]*fbcdn[^"'\\]+\.mp4[^"'\\]*/gi,
    ];
    
    for (const pattern of videoPatterns) {
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        try {
          // 解碼 escaped URL
          let decodedUrl = matches[0].replace(/\\\//g, '/');
          // 清理 URL 結尾
          decodedUrl = decodedUrl.split('"')[0].split("'")[0];
          return decodedUrl;
        } catch {
          // 忽略解碼錯誤
        }
      }
    }

    // 嘗試找 playable_url 或 video_url
    const urlMatch = content.match(/"(?:playable_url|video_url|browser_native_hd_url|browser_native_sd_url)":"([^"]+)"/);
    if (urlMatch && urlMatch[1]) {
      try {
        return urlMatch[1].replace(/\\\//g, '/').replace(/\\u0025/g, '%');
      } catch {
        // 忽略錯誤
      }
    }
  }

  return null;
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
