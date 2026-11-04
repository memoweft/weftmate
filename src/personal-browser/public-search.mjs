import { parseFeed } from 'htmlparser2';
import { canonicalPublicUrl } from './network.mjs';

/** Only the query goes to the public RSS endpoint. Result links are never fetched here. */
export async function searchPublicWeb(query, fetchImpl = fetch) {
  if (typeof query !== 'string' || !query.trim() || query.length > 2048)
    throw Object.assign(new Error('INVALID_COMMAND'), { code: 'INVALID_COMMAND' });
  const url = new URL('https://www.bing.com/search');
  url.searchParams.set('format', 'rss');
  url.searchParams.set('q', query.trim());
  try {
    const options = { credentials: 'omit', redirect: 'manual',
      headers: { accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(12_000) };
    let response = await fetchImpl(url.href, options);
    if (response.status >= 300 && response.status < 400) {
      const next = URL.parse(response.headers.get('location') ?? '', url);
      await response.body?.cancel();
      if (next?.origin !== 'https://cn.bing.com' || next.pathname !== '/search') throw new Error('Unexpected search redirect');
      url.hostname = next.hostname;
      response = await fetchImpl(url.href, options);
    }
    if (!response.ok || !response.body) throw new Error('Search response unavailable');
    const parts = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 512 * 1024) throw new Error('Search response too large');
      parts.push(chunk);
    }
    const feed = parseFeed(Buffer.concat(parts).toString('utf8'));
    if (feed?.type !== 'rss') throw new Error('Expected a search results feed');
    const sources = new Map();
    for (const item of feed.items) {
      let url;
      try { url = canonicalPublicUrl(item.link); } catch { continue; }
      if (!sources.has(url)) sources.set(url, { url, title: item.title?.slice(0, 300), snippet: item.description?.slice(0, 900) });
    }
    return { sources: [...sources.values()] };
  } catch {
    throw Object.assign(new Error('BROWSER_NETWORK_ERROR'), { code: 'BROWSER_NETWORK_ERROR' });
  }
}
