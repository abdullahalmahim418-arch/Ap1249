import * as cheerio from 'cheerio';
import axios from 'axios';
import { makeClient, makeAjaxClient } from '../utils/fetch';
import { cacheGet, cacheSet } from '../utils/cache';

const BASES = (process.env.ANIMEPAHE_BASES || 'https://animepahe.ac,https://animepahe.ru,https://animepahe.com,https://animepahe.org')
  .split(',')
  .map((base) => base.trim().replace(/\/$/, ''))
  .filter(Boolean);
const BASE = BASES[0] || 'https://animepahe.ac';
const FALLBACK_API = (process.env.ANIMEPAHE_FALLBACK_API || 'https://myapi-psi-wheat.vercel.app').replace(/\/$/, '');
const http = makeClient(BASE, BASE + '/');
const ajax = makeAjaxClient(BASE, BASE + '/');

export interface PaheEpisode {
  num: number;
  session: string;
  snapshot: string;
  duration: string;
  created: string;
}

async function paheGet(path: string, params?: Record<string, any>) {
  let lastError: unknown = null;
  for (const base of BASES) {
    try {
      const res = await makeAjaxClient(base, base + '/').get(path, { params });
      if (res.data && !(typeof res.data === 'string' && !res.data.trim())) return res;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('AnimePahe returned an empty response');
}

// Search AnimePahe
export async function searchAnimePahe(query: string): Promise<{ id: string; title: string; session: string }[]> {
  const cacheKey = `pahe:search:${query}`;
  const cached = cacheGet<any[]>(cacheKey);
  if (cached) return cached;

  let data: any[] = [];
  try {
    const res = await paheGet('/api', { m: 'search', q: query });
    data = res.data?.data ?? [];
  } catch {
    try {
      const res = await axios.get(`${FALLBACK_API}/search`, {
        params: { q: query },
        timeout: 20000,
      });
      data = Array.isArray(res.data) ? res.data : [];
    } catch {
      data = [];
    }
  }

  const results = data.map((a: any) => ({
    id: String(a.id ?? a.session),
    title: a.title,
    session: a.session,
  })).filter((a: any) => a.title && a.session);

  cacheSet(cacheKey, results, 'episodes');
  return results;
}

// Get episode list for a session
export async function getPaheEpisodes(session: string, page = 1): Promise<PaheEpisode[]> {
  const cacheKey = `pahe:eps:${session}:${page}`;
  const cached = cacheGet<PaheEpisode[]>(cacheKey);
  if (cached) return cached;

  let rows: any[] = [];
  try {
    const res = await paheGet('/api', { m: 'release', id: session, sort: 'episode_asc', page });
    rows = res.data?.data ?? [];
  } catch {
    const res = await axios.get(`${FALLBACK_API}/episodes`, {
      params: { session },
      timeout: 20000,
    });
    rows = Array.isArray(res.data) ? res.data : (res.data?.episodes ?? []);
  }

  const episodes: PaheEpisode[] = rows.map((e: any) => ({
    num: Number(e.episode ?? e.number),
    session: e.session,
    snapshot: e.snapshot ?? '',
    duration: e.duration ?? '',
    created: e.created_at ?? '',
  })).filter((e) => e.num > 0 && e.session);

  if (episodes.length > 0) cacheSet(cacheKey, episodes, 'episodes');
  return episodes;
}

// Get embed links for a pahe episode (returns kwik embed URLs)
export async function getPaheEmbeds(animeSession: string, episodeSession: string): Promise<{ quality: string; url: string; audio: string }[]> {
  try {
    const res = await ajax.get(`/play/${animeSession}/${episodeSession}`, {
      headers: { Accept: 'text/html' },
    });

    const $ = cheerio.load(res.data);
    const embeds: { quality: string; url: string; audio: string }[] = [];

    $('button[data-src], [data-kwa]').each((_, el) => {
      const url = $(el).attr('data-src') ?? $(el).attr('data-kwa') ?? '';
      const quality = $(el).text().trim() || $(el).attr('data-resolution') || 'HD';
      const audio = $(el).attr('data-audio') ?? 'jpn';
      if (url.includes('kwik')) embeds.push({ quality, url, audio });
    });

    if (embeds.length) return embeds;
  } catch {
    // Fall through to the iframe fallback.
  }

  return [{
    quality: 'Embed',
    url: `${FALLBACK_API}/embed?anime_session=${encodeURIComponent(animeSession)}&episode_session=${encodeURIComponent(episodeSession)}`,
    audio: 'player',
  }];
}
