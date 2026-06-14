"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.malToAnilist = malToAnilist;
exports.getSiteIds = getSiteIds;
exports.searchAnilist = searchAnilist;
const axios_1 = __importDefault(require("axios"));
const fetch_1 = require("./fetch");
const cache_1 = require("./cache");
const animeheaven_1 = require("../scrapers/animeheaven");
async function enrichAnimeHeaven(result) {
    if (!result.siteIds.animeheaven && result.title !== 'Unknown') {
        const id = await (0, animeheaven_1.findAnimeHeavenId)(result.title).catch(() => null);
        if (id)
            result.siteIds.animeheaven = id;
    }
    return result;
}
// MAL ID → AniList ID
async function malToAnilist(malId) {
    const cacheKey = `mal2al:${malId}`;
    const cached = (0, cache_1.cacheGet)(cacheKey);
    if (cached)
        return cached;
    const query = `query ($malId: Int) {
    Media(idMal: $malId, type: ANIME) { id idMal title { romaji english } }
  }`;
    const res = await fetch_1.anilistClient.post('', { query, variables: { malId } });
    const id = res.data?.data?.Media?.id ?? null;
    if (id)
        (0, cache_1.cacheSet)(cacheKey, id);
    return id;
}
// Fetch title from AniList for a given anilistId
async function getAnilistTitle(anilistId) {
    const query = `query ($id: Int) {
    Media(id: $id, type: ANIME) { idMal title { romaji english } }
  }`;
    const res = await fetch_1.anilistClient.post('', { query, variables: { id: anilistId } });
    const media = res.data?.data?.Media;
    return {
        title: media?.title?.english ?? media?.title?.romaji ?? 'Unknown',
        malId: media?.idMal ?? null,
    };
}
// AniList ID → metadata + site-specific IDs
async function getSiteIds(anilistId) {
    const cacheKey = `siteids:${anilistId}`;
    const cached = (0, cache_1.cacheGet)(cacheKey);
    if (cached) {
        const wasMissingAnimeHeaven = !cached.siteIds.animeheaven;
        const enriched = await enrichAnimeHeaven(cached);
        if (wasMissingAnimeHeaven && enriched.siteIds.animeheaven)
            (0, cache_1.cacheSet)(cacheKey, enriched);
        return enriched;
    }
    // Build result shell using AniList (always reliable for title + malId)
    const alInfo = await getAnilistTitle(anilistId).catch(() => ({ title: 'Unknown', malId: null }));
    const result = {
        anilistId,
        malId: alInfo.malId,
        title: alInfo.title,
        siteIds: {},
    };
    // Try Anify for site mappings
    try {
        const res = await axios_1.default.get(`https://api.anify.tv/info/${anilistId}`, {
            params: { fields: 'mappings' },
            timeout: 8000,
        });
        const mappings = res.data?.mappings ?? [];
        for (const m of mappings) {
            if (m.providerId === 'zoro')
                result.siteIds.zoro = m.id;
            if (m.providerId === 'gogoanime')
                result.siteIds.gogoanime = m.id;
            if (m.providerId === 'mal' && !result.malId)
                result.malId = parseInt(m.id);
        }
    }
    catch {
        // Anify down or missing — fall through to direct scraper fallbacks below
    }
    await enrichAnimeHeaven(result);
    // If still no zoro ID, try a slug guess (title-anilistId format common on HiAnime clones)
    // This is a heuristic and may not always work
    if (!result.siteIds.zoro && result.title !== 'Unknown') {
        const slug = result.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        result.siteIds.zoro = `${slug}-${anilistId}`;
    }
    (0, cache_1.cacheSet)(cacheKey, result);
    return result;
}
// Search AniList by title
async function searchAnilist(query) {
    const cacheKey = `alsearch:${query.toLowerCase().trim()}`;
    const cached = (0, cache_1.cacheGet)(cacheKey);
    if (cached)
        return cached;
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
    const res = await fetch_1.anilistClient.post('', { query: gql, variables: { search: query } });
    const list = res.data?.data?.Page?.media ?? [];
    const results = list.map((m) => ({
        id: m.id,
        malId: m.idMal ?? null,
        title: m.title?.english ?? m.title?.romaji,
        coverImage: m.coverImage?.large ?? m.coverImage?.medium ?? '',
        episodes: m.episodes ?? null,
        status: m.status,
        format: m.format,
    }));
    (0, cache_1.cacheSet)(cacheKey, results, 'episodes');
    return results;
}
//# sourceMappingURL=mapper.js.map