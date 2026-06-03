import * as cheerio from 'cheerio';
import { makeClient, makeAjaxClient } from '../utils/fetch';
import { cacheGet, cacheSet } from '../utils/cache';

const BASE = 'https://senshi.live';
const http = makeClient(BASE, BASE + '/');
const ajax = makeAjaxClient(BASE, BASE + '/');

export interface SenshiEpisode {
  num: number;
  id: string;
  title: string;
}

export interface SenshiServer {
  name: string;
  serverId: string;
  sourceId: string;
  type: 'sub' | 'dub' | 'raw';
}

export interface EmbedResult {
  embedUrl: string;
  serverName: string;
  type: string;
}

// Search senshi for an anime by title — returns slug/id
export async function searchSenshi(query: string): Promise<{ title: string; id: string; url: string }[]> {
  const res = await http.get('/search', { params: { keyword: query } });
  const $ = cheerio.load(res.data);
  const results: { title: string; id: string; url: string }[] = [];

  // HiAnime-style selectors — adjust if Senshi differs
  $('.flw-item .film-name a, [class*="film-detail"] h3 a').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const title = $(el).text().trim();
    // ID is the last path segment without query string, e.g. /watch/naruto-123 → naruto-123
    const id = href.split('/').filter(Boolean).pop()?.split('?')[0] ?? '';
    if (title && id) results.push({ title, id, url: BASE + href });
  });

  return results;
}

// Get episode list for a zoro-style anime ID
export async function getEpisodes(animeId: string): Promise<SenshiEpisode[]> {
  const cacheKey = `senshi:eps:${animeId}`;
  const cached = cacheGet<SenshiEpisode[]>(cacheKey);
  if (cached) return cached;

  // Zoro/HiAnime-style: extract numeric part of ID for AJAX call
  // e.g. "naruto-225" → 225 for /ajax/v2/episode/list/225
  const numericId = (animeId.split('-').pop() || animeId) as string;

  const res = await ajax.get(`/ajax/v2/episode/list/${numericId}`);
  const html = (res.data?.html || (typeof res.data === 'string' ? res.data : ''));
  const $ = cheerio.load(html);

  const episodes: SenshiEpisode[] = [];

  $('a[data-id], a[href*="/watch/"]').each((_, el) => {
    const id = $(el).attr('data-id') ?? '';
    const num = parseInt($(el).attr('data-number') ?? $(el).attr('data-ep-num') ?? '0');
    const title = ($(el).attr('title') ?? $(el).text().trim()) || `Episode ${num}`;
    if (id && num > 0) episodes.push({ num, id, title });
  });

  if (episodes.length > 0) cacheSet(cacheKey, episodes, 'episodes');
  return episodes;
}

// Get available servers for a specific episode
export async function getServers(episodeId: string): Promise<SenshiServer[]> {
  const res = await ajax.get('/ajax/v2/episode/servers', {
    params: { episodeId },
  });

  const html = (res.data?.html || (typeof res.data === 'string' ? res.data : ''));
  const $ = cheerio.load(html);
  const servers: SenshiServer[] = [];

  // Sub servers
  $('[data-type="sub"] .server-item, .servers-sub .item, [class*="sub"] li[data-id]').each((_, el) => {
    const sourceId = $(el).attr('data-id') ?? '';
    const serverId = $(el).attr('data-server-id') ?? '';
    const name = $(el).text().trim() || 'Server';
    if (sourceId) servers.push({ name, serverId, sourceId, type: 'sub' });
  });

  // Dub servers
  $('[data-type="dub"] .server-item, .servers-dub .item, [class*="dub"] li[data-id]').each((_, el) => {
    const sourceId = $(el).attr('data-id') ?? '';
    const serverId = $(el).attr('data-server-id') ?? '';
    const name = $(el).text().trim() || 'Server';
    if (sourceId) servers.push({ name, serverId, sourceId, type: 'dub' });
  });

  // Raw servers
  $('[data-type="raw"] .server-item, .servers-raw .item, [class*="raw"] li[data-id]').each((_, el) => {
    const sourceId = $(el).attr('data-id') ?? '';
    const serverId = $(el).attr('data-server-id') ?? '';
    const name = $(el).text().trim() || 'Server';
    if (sourceId) servers.push({ name, serverId, sourceId, type: 'raw' });
  });

  return servers;
}

// Resolve a sourceId to an embed URL
export async function getEmbedUrl(sourceId: string): Promise<EmbedResult | null> {
  try {
    const res = await ajax.get('/ajax/v2/episode/sources', {
      params: { id: sourceId },
    });

    const data = res.data;

    if (data?.link) {
      return {
        embedUrl: data.link,
        serverName: data.server ?? 'unknown',
        type: data.type ?? 'iframe',
      };
    }

    // Some sites wrap it differently
    if (data?.url) {
      return { embedUrl: data.url, serverName: 'server', type: 'iframe' };
    }

    return null;
  } catch {
    return null;
  }
}
