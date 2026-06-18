import axios from 'axios';
import { Buffer } from 'buffer';
import zlib from 'zlib';
import { cacheGet, cacheSet } from '../utils/cache';

// ══════════════════════════════════════════════════════════════
// MIRURO PIPE CONFIGURATION
// ══════════════════════════════════════════════════════════════

const MIRURO_PIPE_URL = 'https://www.miruro.tv/api/secure/pipe';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  Referer: 'https://www.miruro.tv/',
};

// Provider priority used to pick the "canonical" episode list (numbers/titles).
// Providers with both sub+dub and richer metadata are preferred first.
const PROVIDER_PRIORITY = ['bonk', 'kiwi', 'bee', 'bun', 'twin', 'ally', 'moo', 'cog', 'pewe', 'nun', 'telli', 'hop'];

export interface MiruroEpisode {
  num: number;
  id: string;
  title: string;
}

export interface MiruroServer {
  name: string;
  sourceId: string;
  type: 'sub' | 'dub' | 'raw';
}

export interface MiruroEmbedResult {
  embedUrl: string;
  serverName: string;
  type: string;
  referer?: string;
}

interface PipeEpisode {
  id: string;
  number: number;
  title?: string;
}

interface PipeProviderData {
  meta?: { id?: string; title?: string; type?: string };
  episodes?: { sub?: PipeEpisode[]; dub?: PipeEpisode[]; raw?: PipeEpisode[] } | PipeEpisode[];
}

interface PipeData {
  providers?: Record<string, PipeProviderData>;
  malId?: number;
  kitsuId?: number;
  headers?: Record<string, string>;
  streams?: any[];
}

// ══════════════════════════════════════════════════════════════
// ENCODING / DECODING UTILITIES
// ══════════════════════════════════════════════════════════════

function encodePipeRequest(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePipeResponse(encodedStr: string): PipeData {
  const padded = encodedStr + '='.repeat((4 - (encodedStr.length % 4)) % 4);
  const compressed = Buffer.from(padded, 'base64url');
  const decompressed = zlib.gunzipSync(compressed);
  return JSON.parse(decompressed.toString('utf-8'));
}

function translateId(encodedId: string): string {
  try {
    const padded = encodedId + '='.repeat((4 - (encodedId.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64url').toString('utf-8');
    if (decoded.includes(':')) return decoded;
    return encodedId;
  } catch {
    return encodedId;
  }
}

function deepTranslate(obj: any): any {
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      if (key === 'id' && typeof obj[key] === 'string') {
        obj[key] = translateId(obj[key]);
      } else if (typeof obj[key] === 'object') {
        deepTranslate(obj[key]);
      }
    }
  }
  return obj;
}

// ══════════════════════════════════════════════════════════════
// PIPE API CALLS
// ══════════════════════════════════════════════════════════════

async function fetchRawEpisodes(anilistId: number): Promise<PipeData> {
  const cacheKey = `miruro:raw:${anilistId}`;
  const cached = cacheGet<PipeData>(cacheKey);
  if (cached) return cached;

  const payload = { path: 'episodes', method: 'GET', query: { anilistId }, body: null, version: '0.1.0' };
  const encodedReq = encodePipeRequest(payload);

  const res = await axios.get(`${MIRURO_PIPE_URL}?e=${encodedReq}`, {
    headers: HEADERS,
    timeout: 15000,
    responseType: 'text',
    transformResponse: (d) => d,
  });

  const data = deepTranslate(decodePipeResponse(res.data));
  if (data?.providers && Object.keys(data.providers).length > 0) cacheSet(cacheKey, data, 'episodes');
  return data;
}

async function fetchSources(rawEpisodeId: string, provider: string, anilistId: number, category: string): Promise<any> {
  const encId = Buffer.from(rawEpisodeId).toString('base64url');
  const payload = {
    path: 'sources',
    method: 'GET',
    query: { episodeId: encId, provider, category, anilistId },
    body: null,
    version: '0.1.0',
  };
  const encodedReq = encodePipeRequest(payload);

  const res = await axios.get(`${MIRURO_PIPE_URL}?e=${encodedReq}`, {
    headers: HEADERS,
    timeout: 15000,
    responseType: 'text',
    transformResponse: (d) => d,
  });

  return deepTranslate(decodePipeResponse(res.data));
}

function episodesFor(provData: PipeProviderData, category: 'sub' | 'dub' | 'raw'): PipeEpisode[] {
  const episodes = provData.episodes;
  if (!episodes) return [];
  if (Array.isArray(episodes)) return category === 'sub' ? episodes : [];
  return episodes[category] ?? [];
}

// ══════════════════════════════════════════════════════════════
// PUBLIC SCRAPER API
// ══════════════════════════════════════════════════════════════

export async function getMiruroEpisodes(anilistId: number): Promise<MiruroEpisode[]> {
  const data = await fetchRawEpisodes(anilistId);
  const providers = data.providers ?? {};

  // Pick the first provider (by priority) that has a non-empty sub episode list.
  const order = [...PROVIDER_PRIORITY, ...Object.keys(providers).filter((p) => !PROVIDER_PRIORITY.includes(p))];
  let chosen: PipeEpisode[] = [];

  for (const provName of order) {
    const provData = providers[provName];
    if (!provData) continue;
    const eps = episodesFor(provData, 'sub');
    if (eps.length > 0) {
      chosen = eps;
      break;
    }
  }

  return chosen
    .filter((ep) => typeof ep.number === 'number' && ep.number > 0)
    .map((ep) => ({
      num: ep.number,
      id: `${anilistId}:${ep.number}`,
      title: ep.title || `Episode ${ep.number}`,
    }))
    .sort((a, b) => a.num - b.num);
}

export async function getMiruroServers(episodeId: string): Promise<MiruroServer[]> {
  const [anilistIdStr, numStr] = episodeId.split(':');
  const anilistId = parseInt(anilistIdStr);
  const num = parseInt(numStr);
  if (isNaN(anilistId) || isNaN(num)) return [];

  const data = await fetchRawEpisodes(anilistId);
  const providers = data.providers ?? {};
  const servers: MiruroServer[] = [];

  for (const [provName, provData] of Object.entries(providers)) {
    for (const category of ['sub', 'dub', 'raw'] as const) {
      const eps = episodesFor(provData, category);
      const ep = eps.find((e) => e.number === num);
      if (ep) {
        servers.push({
          name: `${provName}-${category}`,
          sourceId: `${anilistId}::${provName}::${category}::${ep.id}`,
          type: category,
        });
      }
    }
  }

  return servers;
}

export async function getMiruroEmbedUrl(sourceId: string): Promise<MiruroEmbedResult | null> {
  const parts = sourceId.split('::');
  if (parts.length < 4) return null;
  const [anilistIdStr, provider, category, ...rest] = parts;
  const rawEpisodeId = rest.join('::');
  const anilistId = parseInt(anilistIdStr);
  if (isNaN(anilistId)) return null;

  try {
    const data = await fetchSources(rawEpisodeId, provider, anilistId, category);
    const streams = data?.streams;
    if (!Array.isArray(streams) || streams.length === 0) return null;

    // Prefer an active stream if marked, otherwise the highest-quality one.
    // We do NOT probe/prefetch the URL — providers like bonk, moo, and bee
    // return single-use or referer-sensitive signed URLs that get consumed or
    // invalidated by a preflight GET, making them unplayable by the time the
    // client requests them. Trust the URL as-is and let the HLS proxy handle it.
    const sorted = [...streams]
      .filter((s) => typeof s?.url === 'string' && /^https?:\/\//i.test(s.url))
      .sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        const qa = parseInt(String(a.quality ?? '').replace(/\D/g, '')) || 0;
        const qb = parseInt(String(b.quality ?? '').replace(/\D/g, '')) || 0;
        return qb - qa;
      });

    const best = sorted[0];
    if (!best) return null;

    // The Referer/Origin a CDN expects is provider-specific, NOT miruro.tv —
    // bonk/kiwi/bee/moo/etc. are separate edge hosts that 403 a request carrying
    // the wrong Referer (this was the root cause of "source returned but won't
    // play": every embed without a per-stream referer was silently defaulting
    // to miruro.tv downstream, which most CDNs reject). Resolution order:
    //   1. a referer on the stream itself
    //   2. provider-level headers the pipe returns alongside `streams`
    //   3. undefined — leave it unset rather than guess a domain that's wrong
    //      for this provider; many CDNs are fine with no Referer at all, but
    //      none are fine with the *wrong* one.
    const headerReferer =
      data?.headers?.Referer ?? data?.headers?.referer ?? data?.headers?.Origin ?? data?.headers?.origin;

    const referer =
      (typeof best.referer === 'string' && best.referer) ||
      (typeof headerReferer === 'string' && headerReferer) ||
      undefined;

    return {
      embedUrl: best.url,
      serverName: provider,
      type: 'hls',
      referer,
    };
  } catch {
    return null;
  }
}
