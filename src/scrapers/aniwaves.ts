import * as cheerio from 'cheerio';
import { makeClient, makeAjaxClient } from '../utils/fetch';
import { cacheGet, cacheSet } from '../utils/cache';

const BASE = 'https://aniwaves.ru';
const http = makeClient(BASE, BASE + '/');
const ajax = makeAjaxClient(BASE, BASE + '/');

export interface WaveEpisode {
  num: number;
  id: string;
  title: string;
}

export interface WaveServer {
  name: string;
  sourceId: string;
  type: 'sub' | 'dub' | 'raw';
}

export async function searchAniWaves(query: string): Promise<{ title: string; id: string; url: string }[]> {
  const res = await http.get('/search', { params: { keyword: query } });
  const $ = cheerio.load(res.data);
  const results: { title: string; id: string; url: string }[] = [];

  $('.film-name a, .flw-item .film-name a, [class*="film"] a[href*="/anime/"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const title = $(el).text().trim();
    const id = href.split('/').filter(Boolean).pop()?.split('?')[0] ?? '';
    if (title && id) results.push({ title, id, url: BASE + href });
  });

  return results;
}

export async function getWaveEpisodes(animeId: string): Promise<WaveEpisode[]> {
  const cacheKey = `wave:eps:${animeId}`;
  const cached = cacheGet<WaveEpisode[]>(cacheKey);
  if (cached) return cached;

  const numericId = animeId.split('-').pop() ?? animeId;
  const res = await ajax.get(`/ajax/v2/episode/list/${numericId}`);
  const html = res.data?.html ?? (typeof res.data === 'string' ? res.data : '');
  const $ = cheerio.load(html);

  const episodes: WaveEpisode[] = [];
  $('a[data-id], a[href*="/watch/"]').each((_, el) => {
    const id = $(el).attr('data-id') ?? '';
    const num = parseInt($(el).attr('data-number') ?? '0');
    const title = $(el).attr('title') ?? `Episode ${num}`;
    if (id && num > 0) episodes.push({ num, id, title });
  });

  if (episodes.length > 0) cacheSet(cacheKey, episodes, 'episodes');
  return episodes;
}

export async function getWaveServers(episodeId: string): Promise<WaveServer[]> {
  const res = await ajax.get('/ajax/v2/episode/servers', { params: { episodeId } });
  const html = res.data?.html ?? '';
  const $ = cheerio.load(html);
  const servers: WaveServer[] = [];

  $('[data-type="sub"] li[data-id], .servers-sub li[data-id]').each((_, el) => {
    const sourceId = $(el).attr('data-id') ?? '';
    const name = $(el).text().trim() || 'Server';
    if (sourceId) servers.push({ name, sourceId, type: 'sub' });
  });

  $('[data-type="dub"] li[data-id], .servers-dub li[data-id]').each((_, el) => {
    const sourceId = $(el).attr('data-id') ?? '';
    const name = $(el).text().trim() || 'Server';
    if (sourceId) servers.push({ name, sourceId, type: 'dub' });
  });

  return servers;
}

export async function getWaveEmbedUrl(sourceId: string): Promise<{ embedUrl: string; serverName: string } | null> {
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
