"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchAnimeHeaven = searchAnimeHeaven;
exports.findAnimeHeavenId = findAnimeHeavenId;
exports.getHeavenEpisodes = getHeavenEpisodes;
exports.getHeavenServers = getHeavenServers;
exports.getHeavenStream = getHeavenStream;
const cheerio = __importStar(require("cheerio"));
const fetch_1 = require("../utils/fetch");
const cache_1 = require("../utils/cache");
const BASE = 'https://animeheaven.me';
const http = (0, fetch_1.makeClient)(BASE, BASE + '/');
function absoluteUrl(url) {
    return new URL(url, BASE).toString();
}
function normalizeTitle(title) {
    return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function scoreTitle(query, title) {
    const needle = normalizeTitle(query);
    const hay = normalizeTitle(title);
    if (hay === needle)
        return 100;
    if (hay.startsWith(needle) || needle.startsWith(hay))
        return 80;
    if (hay.includes(needle) || needle.includes(hay))
        return 60;
    let matches = 0;
    for (const ch of needle)
        if (hay.includes(ch))
            matches++;
    return Math.floor((matches / Math.max(needle.length, 1)) * 40);
}
async function searchAnimeHeaven(query) {
    const cacheKey = `heaven:search:${query.toLowerCase().trim()}`;
    const cached = (0, cache_1.cacheGet)(cacheKey);
    if (cached)
        return cached;
    const res = await http.get('/fastsearch.php', {
        params: { xhr: 1, s: query },
        headers: { Accept: 'text/html,*/*' },
    });
    const $ = cheerio.load(res.data);
    const results = [];
    $('a[href*="anime.php?"]').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        const id = href.split('?')[1]?.trim();
        const title = $(el).find('.fastname').text().trim() || $(el).find('img').attr('alt')?.trim() || '';
        if (!id || !title)
            return;
        results.push({
            id,
            title,
            url: absoluteUrl(`/anime.php?${id}`),
            image: absoluteUrl($(el).find('img').attr('src') ?? ''),
        });
    });
    (0, cache_1.cacheSet)(cacheKey, results, 'episodes');
    return results;
}
async function findAnimeHeavenId(title) {
    const noPossessive = title.replace(/[’']s\b/gi, '');
    const variants = Array.from(new Set([
        title,
        noPossessive,
        title.replace(/[’']/g, ''),
        noPossessive.replace(/[+]/g, ' '),
        title.replace(/[+]/g, ' '),
        title.split(/[:(|-]/)[0]?.trim(),
        noPossessive.split(/[:(|-]/)[0]?.trim(),
        title.replace(/[’']/g, '').split(/\s+/).slice(0, 2).join(' '),
        noPossessive.split(/\s+/).slice(0, 2).join(' '),
        title.replace(/[’']/g, '').split(/\s+/)[0],
        noPossessive.split(/\s+/)[0],
    ].filter((value) => Boolean(value && value.trim().length >= 3))));
    const allResults = [];
    for (const variant of variants) {
        const results = await searchAnimeHeaven(variant).catch(() => []);
        allResults.push(...results);
        if (results.some((result) => scoreTitle(title, result.title) >= 80))
            break;
    }
    const unique = Array.from(new Map(allResults.map((result) => [result.id, result])).values());
    if (!unique.length)
        return null;
    return unique
        .map((result) => ({ result, score: scoreTitle(title, result.title) }))
        .sort((a, b) => b.score - a.score)[0].result.id;
}
async function getHeavenEpisodes(animeId) {
    const cacheKey = `heaven:eps:${animeId}`;
    const cached = (0, cache_1.cacheGet)(cacheKey);
    if (cached)
        return cached;
    const res = await http.get(`/anime.php?${animeId}`);
    const $ = cheerio.load(res.data);
    const episodes = [];
    $('a[onmouseover*="gateh("], a[onclick*="gatea("]').each((_, el) => {
        const attr = $(el).attr('onmouseover') || $(el).attr('onclick') || '';
        const key = attr.match(/gate[ha]\("([^"]+)"/)?.[1];
        const rawNum = $(el).find('.watch2').first().text().trim();
        const num = Number(rawNum.replace(/^0+(\d)/, '$1'));
        if (!key || !Number.isFinite(num))
            return;
        episodes.push({ id: key, num, title: `Episode ${rawNum}` });
    });
    const unique = Array.from(new Map(episodes.map((ep) => [ep.id, ep])).values())
        .sort((a, b) => a.num - b.num);
    (0, cache_1.cacheSet)(cacheKey, unique, 'episodes');
    return unique;
}
async function getHeavenServers(episodeId) {
    return [
        { name: 'AnimeHeaven', sourceId: episodeId, type: 'sub' },
    ];
}
async function getHeavenStream(episodeId) {
    const cacheKey = `heaven:stream:${episodeId}`;
    const cached = (0, cache_1.cacheGet)(cacheKey);
    if (cached)
        return cached;
    const res = await http.get('/gate.php', {
        headers: {
            Cookie: `key=${episodeId}`,
            Referer: `${BASE}/`,
            Accept: 'text/html,*/*',
        },
    });
    const $ = cheerio.load(res.data);
    const sources = $('video source')
        .map((_, el) => $(el).attr('src')?.trim() || '')
        .get()
        .filter((url) => /^https?:\/\//i.test(url));
    const primary = sources.find((url) => url.includes('/video.mp4')) || sources[0];
    if (!primary)
        return null;
    const stream = {
        embedUrl: `${BASE}/gate.php`,
        streamUrl: primary,
        mp4: primary,
        m3u8: null,
        type: 'mp4',
        servers: Array.from(new Set(sources)),
    };
    (0, cache_1.cacheSet)(cacheKey, stream, 'stream');
    return stream;
}
//# sourceMappingURL=animeheaven.js.map