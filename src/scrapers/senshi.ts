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

function senshiType(status: string): SenshiServer['type'] {
  return status.toLowerCase().includes('dub') ? 'dub' : 'sub';
}

async function getInternalAnimeId(animeId: string): Promise<string> {
  if (/^\d+$/.test(animeId)) return animeId;
  const res = await http.get(`/anime/${animeId}`, {
    headers: { Accept: 'application/json' },
  });
  return String(res.data?.id ?? animeId);
}

export async function searchSenshi(query: string): Promise<{ title: string; id: string; url: string }[]> {
  try {
    const res = await http.post('/anime/filter', { searchTerm: query, page: 1, limit: 10 }, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    const rows = res.data?.data ?? [];
    return rows.map((anime: any) => {
      const id = String(anime.public_id ?? anime.id ?? '');
      const title = anime.title ?? anime.title_english ?? anime.name ?? anime.romaji_title ?? '';
      return { title, id, url: `${BASE}/watch/${id}/1` };
    }).filter((anime: any) => anime.title && anime.id);
  } catch {
    // Fall through to the legacy HTML scraper.
  }

  const res = await http.get('/search', { params: { keyword: query } });
  const $ = cheerio.load(res.data);
  const results: { title: string; id: string; url: string }[] = [];

  $('.flw-item .film-name a, [class*="film-detail"] h3 a').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const title = $(el).text().trim();
    const id = href.split('/').filter(Boolean).pop()?.split('?')[0] ?? '';
    if (title && id) results.push({ title, id, url: BASE + href });
  });

  return results;
}

export async function getEpisodes(animeId: string): Promise<SenshiEpisode[]> {
  const cacheKey = `senshi:eps:${animeId}`;
  const cached = cacheGet<SenshiEpisode[]>(cacheKey);
  if (cached) return cached;

  const internalId = await getInternalAnimeId(animeId);
  const res = await http.get(`/episodes/${internalId}`, {
    headers: { Accept: 'application/json' },
  });

  const episodes: SenshiEpisode[] = (Array.isArray(res.data) ? res.data : []).map((ep: any) => ({
    num: Number(ep.ep_id),
    id: `${internalId}:${ep.ep_id}`,
    title: ep.ep_title || `Episode ${ep.ep_id}`,
  })).filter((ep) => ep.num > 0);

  if (episodes.length > 0) cacheSet(cacheKey, episodes, 'episodes');
  return episodes;
}

export async function getServers(episodeId: string): Promise<SenshiServer[]> {
  const [animeId, ep] = episodeId.split(':');
  const res = await http.get(`/episode-embeds/${animeId}/${ep}`, {
    headers: { Accept: 'application/json' },
  });

  return (Array.isArray(res.data) ? res.data : []).flatMap((embed: any, index: number) => {
    const urls = [embed.url, embed.server2, embed.serverFM].filter(Boolean);
    return urls.map((url: string, urlIndex: number) => ({
      name: embed.status || `Server ${index + 1}`,
      serverId: `${index}-${urlIndex}`,
      sourceId: url,
      type: senshiType(embed.status || ''),
    }));
  });
}

export async function getEmbedUrl(sourceId: string): Promise<EmbedResult | null> {
  if (/^https?:\/\//i.test(sourceId)) {
    return {
      embedUrl: sourceId,
      serverName: new URL(sourceId).hostname,
      type: sourceId.includes('.m3u8') ? 'hls' : 'iframe',
    };
  }

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

    if (data?.url) {
      return { embedUrl: data.url, serverName: 'server', type: 'iframe' };
    }

    return null;
  } catch {
    return null;
  }
}
