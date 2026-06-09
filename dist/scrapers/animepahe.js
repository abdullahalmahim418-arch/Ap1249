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
exports.searchAnimePahe = searchAnimePahe;
exports.getPaheEpisodes = getPaheEpisodes;
exports.getPaheEmbeds = getPaheEmbeds;
const cheerio = __importStar(require("cheerio"));
const fetch_1 = require("../utils/fetch");
const cache_1 = require("../utils/cache");
const BASE = 'https://animepahe.pw';
const http = (0, fetch_1.makeClient)(BASE, BASE + '/');
const ajax = (0, fetch_1.makeAjaxClient)(BASE, BASE + '/');
// Search AnimePahe
async function searchAnimePahe(query) {
    const cacheKey = `pahe:search:${query}`;
    const cached = (0, cache_1.cacheGet)(cacheKey);
    if (cached)
        return cached;
    const res = await ajax.get('/api', { params: { m: 'search', q: query } });
    const data = res.data?.data ?? [];
    const results = data.map((a) => ({
        id: String(a.id),
        title: a.title,
        session: a.session,
    }));
    (0, cache_1.cacheSet)(cacheKey, results, 'episodes');
    return results;
}
// Get episode list for a session
async function getPaheEpisodes(session, page = 1) {
    const cacheKey = `pahe:eps:${session}:${page}`;
    const cached = (0, cache_1.cacheGet)(cacheKey);
    if (cached)
        return cached;
    const res = await ajax.get('/api', {
        params: { m: 'release', id: session, sort: 'episode_asc', page },
    });
    const episodes = (res.data?.data ?? []).map((e) => ({
        num: e.episode,
        session: e.session,
        snapshot: e.snapshot ?? '',
        duration: e.duration ?? '',
        created: e.created_at ?? '',
    }));
    if (episodes.length > 0)
        (0, cache_1.cacheSet)(cacheKey, episodes, 'episodes');
    return episodes;
}
// Get embed links for a pahe episode (returns kwik embed URLs)
async function getPaheEmbeds(animeSession, episodeSession) {
    const res = await ajax.get(`/play/${animeSession}/${episodeSession}`, {
        headers: { Accept: 'text/html' },
    });
    const $ = cheerio.load(res.data);
    const embeds = [];
    // AnimePahe serves buttons that link to kwik.si
    $('button[data-src], [data-kwa]').each((_, el) => {
        const url = $(el).attr('data-src') ?? $(el).attr('data-kwa') ?? '';
        const quality = $(el).text().trim() || $(el).attr('data-resolution') || 'HD';
        const audio = $(el).attr('data-audio') ?? 'jpn';
        if (url.includes('kwik'))
            embeds.push({ quality, url, audio });
    });
    return embeds;
}
//# sourceMappingURL=animepahe.js.map