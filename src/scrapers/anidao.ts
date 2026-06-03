import * as cheerio from 'cheerio';
import { makeClient, makeAjaxClient } from '../utils/fetch';
import { cacheGet, cacheSet } from '../utils/cache';

const BASE = 'https://anidao.to';
const http = makeClient(BASE, BASE + '/');
const ajax = makeAjaxClient(BASE, BASE + '/');

export interface DaoEpisode {
  num: number;
  id: string;
  title: string;
}

export interface DaoServer {
  name: string;
  sourceId: string;
  type: 'sub' | 'dub' | 'raw';
}

// Search AniDao
export async function searchAniDao(query: string): Promise<{ title: string; id: string; url: string }[]> {
  const res = await http.get('/search', { params: { keyword: query } });
  const $ = cheerio.load(res.data);
  const results: { title: string; id: string; url: string }[] = [];

  $('.an-anime-card__title a[href*="/anime/"], .an-anime-card__image[href*="/anime/"], a[href*="/anime/"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const title = $(el).text().trim() || $(el).attr('title') || $(el).find('img').attr('alt') || '';
    const id = href.split('/').filter(Boolean).pop()?.split('?')[0] ?? '';
    if (title && id) results.push({ title, id, url: BASE + href });
  });

  return results;
}

// Get episode list
export async function getDaoEpisodes(animeId: string): Promise<DaoEpisode[]> {
  const cacheKey = `dao:eps:${animeId}`;
  const cached = cacheGet<DaoEpisode[]>(cacheKey);
  if (cached) return cached;

  const res = await http.get(`/anime/${animeId}`);
  const $ = cheerio.load(res.data);

  const byEpisode = new Map<number, DaoEpisode>();
  $('a[href*="/watch-online/"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const text = ($(el).attr('aria-label') ?? $(el).text()).trim();
    const match = /episode-(\d+)/i.exec(href) ?? /episode\s+(\d+)/i.exec(text);
    const num = match ? parseInt(match[1]) : 0;
    if (!href || !num || href === '#') return;
    const title = text || `Episode ${num}`;
    const current = byEpisode.get(num);
    const hasStaleBlock = /\/watch-online\/[^/]+-\d+-episode-\d+$/i.test(href);
    const normalizedHref = hasStaleBlock ? `/watch-online/${animeId}-episode-${num}` : href;
    const isPreferred = /\/watch-online\/[^/]+-episode-\d+$/i.test(normalizedHref)
      && !/\/watch-online\/[^/]+-\d+-episode-\d+$/i.test(normalizedHref);
    const currentIsPreferred = current ? /\/watch-online\/[^/]+-episode-\d+$/i.test(current.id)
      && !/\/watch-online\/[^/]+-\d+-episode-\d+$/i.test(current.id) : false;
    if (!current || (isPreferred && !currentIsPreferred)) {
      byEpisode.set(num, { num, id: normalizedHref, title });
    }
  });

  const episodes = [...byEpisode.values()];
  episodes.sort((a, b) => a.num - b.num);
  if (episodes.length > 0) cacheSet(cacheKey, episodes, 'episodes');
  return episodes;
}

// Get servers for an episode
export async function getDaoServers(episodeId: string): Promise<DaoServer[]> {
  const res = await http.get(episodeId);
  const $ = cheerio.load(res.data);
  const servers: DaoServer[] = [];

  $('[data-an-video]').each((_, el) => {
    const sourceId = $(el).attr('data-an-video') ?? '';
    const panel = $(el).closest('[data-an-panel]').attr('data-an-panel') ?? '';
    const type: DaoServer['type'] = panel === 'dub' ? 'dub' : 'sub';
    const name = $(el).text().trim() || $(el).attr('data-an-server-btn') || 'Server';
    if (sourceId) servers.push({ name, sourceId, type });
  });

  return servers;
}

// Get embed URL
export async function getDaoEmbedUrl(sourceId: string): Promise<{ embedUrl: string; serverName: string } | null> {
  if (/^https?:\/\//i.test(sourceId)) {
    return { embedUrl: sourceId, serverName: new URL(sourceId).hostname };
  }

  try {
    const res = await ajax.get('/ajax/v2/episode/sources', { params: { id: sourceId } });
    const data = res.data;
    if (data?.link) return { embedUrl: data.link, serverName: data.server ?? 'server' };
    if (data?.url) return { embedUrl: data.url, serverName: 'server' };
    return null;
  } catch {
    return null;
  }
}
