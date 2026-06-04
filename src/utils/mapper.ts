import axios from 'axios';
import { anilistClient } from './fetch';
import { cacheGet, cacheSet } from './cache';
import { searchAnimePahe } from '../scrapers/animepahe';

export interface SiteIds {
  anilistId: number;
  malId: number | null;
  title: string;
  siteIds: {
    zoro?: string;
    gogoanime?: string;
    animepahe?: string;
    anidao?: string;
  };
}

// MAL ID → AniList ID
export async function malToAnilist(malId: number): Promise<number | null> {
  const cacheKey = `mal2al:${malId}`;
  const cached = cacheGet<number>(cacheKey);
  if (cached) return cached;

  const query = `query ($malId: Int) {
    Media(idMal: $malId, type: ANIME) { id idMal title { romaji english } }
  }`;
  const res = await anilistClient.post('', { query, variables: { malId } });
  const id = res.data?.data?.Media?.id ?? null;
  if (id) cacheSet(cacheKey, id);
  return id;
}

// Fetch title from AniList for a given anilistId
async function getAnilistTitle(anilistId: number): Promise<{ title: string; malId: number | null }> {
  const query = `query ($id: Int) {
    Media(id: $id, type: ANIME) { idMal title { romaji english } }
  }`;
  const res = await anilistClient.post('', { query, variables: { id: anilistId } });
  const media = res.data?.data?.Media;
  return {
    title: media?.title?.english ?? media?.title?.romaji ?? 'Unknown',
    malId: media?.idMal ?? null,
  };
}

// Search AnimePahe directly by title and return best-match session
async function findPaheSession(title: string): Promise<string | null> {
  try {
    const results = await searchAnimePahe(title);
    if (!results.length) return null;

    // Score by title similarity — prefer exact/close matches
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const needle = normalize(title);

    let best: { session: string; score: number } | null = null;
    for (const r of results) {
      const hay = normalize(r.title);
      let score = 0;
      if (hay === needle) score = 100;
      else if (hay.startsWith(needle) || needle.startsWith(hay)) score = 80;
      else if (hay.includes(needle) || needle.includes(hay)) score = 60;
      else {
        // Count matching words
        const needleWords = needle.split('');
        let matches = 0;
        for (const ch of needleWords) if (hay.includes(ch)) matches++;
        score = Math.floor((matches / Math.max(needle.length, 1)) * 40);
      }
      if (!best || score > best.score) best = { session: r.session, score };
    }

    // Only use if score is reasonable
    return best && best.score >= 40 ? best.session : results[0].session;
  } catch {
    return null;
  }
}

// AniList ID → metadata + site-specific IDs
export async function getSiteIds(anilistId: number): Promise<SiteIds | null> {
  const cacheKey = `siteids:${anilistId}`;
  const cached = cacheGet<SiteIds>(cacheKey);
  if (cached) return cached;

  // Build result shell using AniList (always reliable for title + malId)
  const alInfo = await getAnilistTitle(anilistId).catch(() => ({ title: 'Unknown', malId: null }));

  const result: SiteIds = {
    anilistId,
    malId: alInfo.malId,
    title: alInfo.title,
    siteIds: {},
  };

  // Try Anify for site mappings
  try {
    const res = await axios.get(`https://api.anify.tv/info/${anilistId}`, {
      params: { fields: 'mappings' },
      timeout: 8000,
    });
    const mappings: any[] = res.data?.mappings ?? [];
    for (const m of mappings) {
      if (m.providerId === 'zoro')      result.siteIds.zoro = m.id;
      if (m.providerId === 'gogoanime') result.siteIds.gogoanime = m.id;
      if (m.providerId === 'animepahe') result.siteIds.animepahe = m.id;
      if (m.providerId === 'mal' && !result.malId) result.malId = parseInt(m.id);
    }
  } catch {
    // Anify down or missing — fall through to direct scraper fallbacks below
  }

  // If Anify didn't give us an AnimePahe session, search directly
  if (!result.siteIds.animepahe && result.title !== 'Unknown') {
    const session = await findPaheSession(result.title);
    if (session) result.siteIds.animepahe = session;
  }

  // If still no zoro ID, try a slug guess (title-anilistId format common on HiAnime clones)
  // This is a heuristic and may not always work
  if (!result.siteIds.zoro && result.title !== 'Unknown') {
    const slug = result.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    result.siteIds.zoro = `${slug}-${anilistId}`;
  }

  cacheSet(cacheKey, result);
  return result;
}

// Search AniList by title
export async function searchAnilist(query: string): Promise<{
  id: number; malId: number | null; title: string; coverImage: string; episodes: number | null; status: string; format: string;
}[]> {
  const cacheKey = `alsearch:${query.toLowerCase().trim()}`;
  const cached = cacheGet<any[]>(cacheKey);
  if (cached) return cached;

  const gql = `query ($search: String) {
    Page(page: 1, perPage: 10) {
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        id idMal episodes
        title { romaji english }
        coverImage { large medium }
        status format
      }
    }
  }`;

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
