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
exports.searchAniWaves = searchAniWaves;
exports.getWaveEpisodes = getWaveEpisodes;
exports.getWaveServers = getWaveServers;
exports.getWaveEmbedUrl = getWaveEmbedUrl;
const cheerio = __importStar(require("cheerio"));
const fetch_1 = require("../utils/fetch");
const cache_1 = require("../utils/cache");
const BASE = 'https://aniwaves.ru';
const http = (0, fetch_1.makeClient)(BASE, BASE + '/');
const ajax = (0, fetch_1.makeAjaxClient)(BASE, BASE + '/');
function titleSlug(input) {
    return input.replace(/-\d+$/, '').toLowerCase();
}
function serverType(raw) {
    const value = raw.toLowerCase();
    if (value.includes('dub'))
        return 'dub';
    if (value.includes('raw'))
        return 'raw';
    return 'sub';
}
async function resolveWaveWatchId(animeId) {
    const direct = animeId.match(/-(\d{3,})$/)?.[1];
    if (direct && direct !== animeId.split('-').pop())
        return direct;
    const query = titleSlug(animeId);
    const res = await http.get('/filter', { params: { keyword: query } });
    const $ = cheerio.load(res.data);
    const wanted = query.replace(/-/g, ' ');
    let fallback = '';
    let exact = '';
    $('a[href^="/watch/"]').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        const id = href.match(/-(\d+)$/)?.[1] ?? '';
        const title = $(el).find('.name, .d-title').first().text().trim().toLowerCase()
            || $(el).attr('data-jp')?.toLowerCase()
            || '';
        if (id && !fallback)
            fallback = id;
        if (id && (title === wanted || href.includes(`/watch/${query}-`)))
            exact = id;
    });
    return exact || fallback || null;
}
async function searchAniWaves(query) {
    const res = await http.get('/filter', { params: { keyword: query } });
    const $ = cheerio.load(res.data);
    const results = [];
    $('a[href^="/watch/"]').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        const id = href.split('/').filter(Boolean).pop()?.split('?')[0] ?? '';
        const title = $(el).find('.name, .d-title').first().text().trim() || $(el).text().trim();
        if (title && id && !results.some((r) => r.id === id))
            results.push({ title, id, url: BASE + href });
    });
    return results;
}
async function getWaveEpisodes(animeId) {
    const cacheKey = `wave:eps:${animeId}`;
    const cached = (0, cache_1.cacheGet)(cacheKey);
    if (cached)
        return cached;
    const watchId = await resolveWaveWatchId(animeId);
    if (!watchId)
        return [];
    const res = await ajax.get(`/ajax/episode/list/${watchId}`, {
        headers: { Referer: `${BASE}/watch/${animeId}` },
    });
    const html = res.data?.result ?? res.data?.html ?? (typeof res.data === 'string' ? res.data : '');
    const $ = cheerio.load(html);
    const episodes = [];
    $('a[data-ids][data-num]').each((_, el) => {
        const id = $(el).attr('data-ids') ?? '';
        const num = Number($(el).attr('data-num') ?? 0);
        const title = $(el).attr('title') ?? ($(el).text().replace(/\s+/g, ' ').trim() || `Episode ${num}`);
        if (id && num > 0)
            episodes.push({ num, id, title });
    });
    if (episodes.length > 0)
        (0, cache_1.cacheSet)(cacheKey, episodes, 'episodes');
    return episodes;
}
async function getWaveServers(episodeId) {
    const res = await ajax.get(`/ajax/server/list?servers=${episodeId}`);
    const html = res.data?.result ?? res.data?.html ?? '';
    const $ = cheerio.load(html);
    const servers = [];
    $('[data-link-id]').each((_, el) => {
        const sourceId = $(el).attr('data-link-id') ?? '';
        const group = $(el).closest('[data-type]').attr('data-type') ?? '';
        const name = $(el).text().replace(/\s+/g, ' ').trim() || `Server ${$(el).attr('data-sv-id') ?? ''}`.trim();
        if (sourceId)
            servers.push({ name, sourceId, type: serverType(group || name) });
    });
    return servers;
}
async function getWaveEmbedUrl(sourceId) {
    if (/^https?:\/\//i.test(sourceId))
        return { embedUrl: sourceId, serverName: new URL(sourceId).hostname };
    try {
        const res = await ajax.get('/ajax/sources', {
            params: { id: sourceId, asi: 0, autoPlay: 0 },
        });
        const data = res.data?.result ?? res.data;
        if (data?.url)
            return { embedUrl: data.url, serverName: String(data.server ?? 'server') };
        if (data?.link)
            return { embedUrl: data.link, serverName: data.server ?? 'server' };
        return null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=aniwaves.js.map