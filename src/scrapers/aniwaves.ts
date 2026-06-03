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
  serverId?: string;
  type: 'sub' | 'dub' | 'raw';
}

export async function searchAniWaves(query: string): Promise<{ title: string; id: string; url: string }[]> {
  const res = await http.get('/filter', { params: { keyword: query } });
  const $ = cheerio.load(res.data);
  const results: { title: string; id: string; url: string }[] = [];

  $('.name.d-title[href*="/watch/"], #list-items a.d-title[href*="/watch/"], .ani.poster a[href*="/watch/"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const title = $(el).text().trim() || $(el).attr('data-jp') || $(el).find('img').attr('alt')?.replace(/\s+Japanese english subbed$/i, '') || '';
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
  const res = await ajax.get(`/ajax/episode/list/${numericId}`);
  const html = res.data?.result ?? res.data?.html ?? (typeof res.data === 'string' ? res.data : '');
  const $ = cheerio.load(html);

  const episodes: WaveEpisode[] = [];
  $('a[data-ids][data-num]').each((_, el) => {
    const ids = $(el).attr('data-ids') ?? '';
    const num = parseInt($(el).attr('data-num') ?? '0');
    const id = ids || `${numericId}&eps=${num}`;
    const title = $(el).attr('title') ?? `Episode ${num}`;
    if (id && num > 0) episodes.push({ num, id, title });
  });

  if (episodes.length > 0) cacheSet(cacheKey, episodes, 'episodes');
  return episodes;
}

export async function getWaveServers(episodeId: string): Promise<WaveServer[]> {
  const [animeId, query = ''] = episodeId.split('&');
  const ep = new URLSearchParams(query).get('eps') ?? episodeId.split('eps=').pop() ?? '';
  const res = await ajax.get(`/ajax/server/list?servers=${encodeURIComponent(animeId)}&eps=${encodeURIComponent(ep)}`);
  const html = res.data?.result ?? res.data?.html ?? '';
  const $ = cheerio.load(html);
  const servers: WaveServer[] = [];

  $('[data-type="sub"] li[data-link-id], [data-type="ssub"] li[data-link-id]').each((_, el) => {
    const sourceId = $(el).attr('data-link-id') ?? '';
    const serverId = $(el).attr('data-sv-id') ?? '';
    const name = $(el).text().trim() || 'Server';
    if (sourceId) servers.push({ name, serverId, sourceId, type: 'sub' });
  });

  $('[data-type="dub"] li[data-link-id]').each((_, el) => {
    const sourceId = $(el).attr('data-link-id') ?? '';
    const serverId = $(el).attr('data-sv-id') ?? '';
    const name = $(el).text().trim() || 'Server';
    if (sourceId) servers.push({ name, serverId, sourceId, type: 'dub' });
  });

  return servers;
}

export async function getWaveEmbedUrl(sourceId: string): Promise<{ embedUrl: string; serverName: string } | null> {
  try {
    const res = await ajax.get('/ajax/sources', { params: { id: sourceId, asi: 0, autoPlay: 0 } });
    const data = res.data;
    if (data?.result?.url) return { embedUrl: data.result.url, serverName: String(data.result.server ?? 'server') };
    if (data?.link) return { embedUrl: data.link, serverName: data.server ?? 'server' };
    if (data?.url) return { embedUrl: data.url, serverName: 'server' };
    return null;
  } catch {
    return null;
  }
}
