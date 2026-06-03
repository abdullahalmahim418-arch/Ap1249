import axios from 'axios';
import { anilistClient } from './fetch';
import { cacheGet, cacheSet } from './cache';
import { searchAnimePahe } from '../scrapers/animepahe';
import { searchAniDao } from '../scrapers/anidao';
import { searchAniWaves } from '../scrapers/aniwaves';
import { searchSenshi } from '../scrapers/senshi';

export interface SiteIds {
  anilistId: number;
  malId: number | null;
  title: string;
  siteIds: {
    zoro?: string;       // senshi.live uses zoro-style IDs
    senshi?: string;
    wave?: string;
    gogoanime?: string;
    animepahe?: string;
    anidao?: string;
  };
}

interface AniListMeta {
  malId: number | null;
  title: string;
  titles: string[];
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function bestMatch<T extends { title: string }>(items: T[], titles: string[]): T | undefined {
  const normalizedTitles = titles.map(normalizeTitle).filter(Boolean);
  return items.find((item) => normalizedTitles.includes(normalizeTitle(item.title)))
      ?? items.find((item) => normalizedTitles.some((title) => normalizeTitle(item.title).startsWith(title)));
}

async function getAniListMeta(anilistId: number): Promise<AniListMeta | null> {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id idMal
        title { romaji english native }
      }
    }
  `;
  const res = await anilistClient.post('', { query, variables: { id: anilistId } });
  const media = res.data?.data?.Media;
  if (!media) return null;

  const titles = [
    media.title?.english,
    media.title?.romaji,
    media.title?.native,
  ].filter(Boolean);

  return {
    malId: media.idMal ?? null,
    title: titles[0] ?? 'Unknown',
    titles,
  };
}

async function enrichFromProviderSearch(result: SiteIds, titles: string[]): Promise<void> {
  const query = result.title;

  const lookups = await Promise.allSettled([
    searchAniWaves(query),
    searchAniDao(query),
    searchAnimePahe(query),
    searchSenshi(query),
  ]);

  const wave = lookups[0].status === 'fulfilled' ? bestMatch(lookups[0].value, titles) : undefined;
  if (wave?.id) {
    result.siteIds.wave = wave.id;
    result.siteIds.zoro = result.siteIds.zoro ?? wave.id;
  }

  const dao = lookups[1].status === 'fulfilled' ? bestMatch(lookups[1].value, titles) : undefined;
  if (dao?.id) result.siteIds.anidao = dao.id;

  const pahe = lookups[2].status === 'fulfilled' ? bestMatch(lookups[2].value, titles) : undefined;
  if (pahe?.session) result.siteIds.animepahe = pahe.session;

  const senshi = lookups[3].status === 'fulfilled' ? bestMatch(lookups[3].value, titles) : undefined;
  if (senshi?.id) result.siteIds.senshi = senshi.id;
}

// MAL ID → AniList ID via AniList GraphQL
export async function malToAnilist(malId: number): Promise<number | null> {
  const cacheKey = `mal2al:${malId}`;
  const cached = cacheGet<number>(cacheKey);
  if (cached) return cached;

  const query = `
    query ($malId: Int) {
      Media(idMal: $malId, type: ANIME) {
        id
        idMal
        title { romaji english }
      }
    }
  `;

  const res = await anilistClient.post('', { query, variables: { malId } });
  const id = res.data?.data?.Media?.id ?? null;
  if (id) cacheSet(cacheKey, id);
  return id;
}

// AniList ID → anime metadata + site-specific IDs via Anify
export async function getSiteIds(anilistId: number): Promise<SiteIds | null> {
  const cacheKey = `siteids:${anilistId}`;
  const cached = cacheGet<SiteIds>(cacheKey);
  if (cached) return cached;

  const meta = await getAniListMeta(anilistId);

  // Try Anify first
  try {
    const res = await axios.get(`https://api.anify.tv/info/${anilistId}`, {
      params: { fields: 'id,title,mappings,coverImage,episodes' },
      timeout: 10000,
    });

    const data = res.data;
    const mappings: any[] = data?.mappings ?? [];

    const result: SiteIds = {
      anilistId,
      malId: meta?.malId ?? null,
      title: data?.title?.english ?? data?.title?.romaji ?? meta?.title ?? 'Unknown',
      siteIds: {},
    };

    for (const m of mappings) {
      if (m.providerId === 'zoro')      result.siteIds.zoro = m.id;
      if (m.providerId === 'zoro')      result.siteIds.wave = m.id;
      if (m.providerId === 'gogoanime') result.siteIds.gogoanime = m.id;
      if (m.providerId === 'animepahe') result.siteIds.animepahe = m.id;
      if (m.providerId === 'mal')       result.malId = parseInt(m.id);
    }

    await enrichFromProviderSearch(result, meta?.titles ?? [result.title]);

    cacheSet(cacheKey, result);
    return result;
  } catch (e) {
    // Fallback: use AniList metadata plus live provider search.
    try {
      if (!meta) return null;

      const result: SiteIds = {
        anilistId,
        malId: meta.malId,
        title: meta.title,
        siteIds: {},
      };
      await enrichFromProviderSearch(result, meta.titles);
      cacheSet(cacheKey, result);
      return result;
    } catch {
      return null;
    }
  }
}

// Search AniList by title → return anilistId + malId
export async function searchAnilist(query: string): Promise<{
  id: number; malId: number | null; title: string; coverImage: string; episodes: number | null;
}[]> {
  const cacheKey = `alsearch:${query.toLowerCase().trim()}`;
  const cached = cacheGet<any[]>(cacheKey);
  if (cached) return cached;

  const gql = `
    query ($search: String) {
      Page(page: 1, perPage: 10) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          idMal
          episodes
          title { romaji english }
          coverImage { large medium }
          status
          format
        }
      }
    }
  `;

  const res = await anilistClient.post('', { query: gql, variables: { search: query } });
  const list = res.data?.data?.Page?.media ?? [];

  const results = list.map((m: any) => ({
    id: m.id,
    malId: m.idMal ?? null,
    title: m.title?.english ?? m.title?.romaji,
    coverImage: m.coverImage?.large ?? m.coverImage?.medium ?? '',
    episodes: m.episodes ?? null,
    status: m.status,
    format: m.format,
  }));

  cacheSet(cacheKey, results, 'episodes');
  return results;
}
