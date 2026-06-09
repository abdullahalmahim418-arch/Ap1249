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
exports.searchAniDao = searchAniDao;
exports.getDaoEpisodes = getDaoEpisodes;
exports.getDaoServers = getDaoServers;
exports.getDaoEmbedUrl = getDaoEmbedUrl;
const cheerio = __importStar(require("cheerio"));
const fetch_1 = require("../utils/fetch");
const cache_1 = require("../utils/cache");
const BASE = 'https://anidao.to';
const http = (0, fetch_1.makeClient)(BASE, BASE + '/');
const ajax = (0, fetch_1.makeAjaxClient)(BASE, BASE + '/');
// Search AniDao
async function searchAniDao(query) {
    const res = await http.get('/search', { params: { keyword: query } });
    const $ = cheerio.load(res.data);
    const results = [];
    $('.film-name a, .flw-item .film-name a').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        const title = $(el).text().trim();
        const id = href.split('/').filter(Boolean).pop()?.split('?')[0] ?? '';
        if (title && id)
            results.push({ title, id, url: BASE + href });
    });
    return results;
}
// Get episode list
async function getDaoEpisodes(animeId) {
    const cacheKey = `dao:eps:${animeId}`;
    const cached = (0, cache_1.cacheGet)(cacheKey);
    if (cached)
        return cached;
    const numericId = animeId.split('-').pop() ?? animeId;
    const res = await ajax.get(`/ajax/v2/episode/list/${numericId}`);
    const html = res.data?.html ?? (typeof res.data === 'string' ? res.data : '');
    const $ = cheerio.load(html);
    const episodes = [];
    $('a[data-id], a[href*="/watch/"]').each((_, el) => {
        const id = $(el).attr('data-id') ?? '';
        const num = parseInt($(el).attr('data-number') ?? '0');
        const title = $(el).attr('title') ?? `Episode ${num}`;
        if (id && num > 0)
            episodes.push({ num, id, title });
    });
    if (episodes.length > 0)
        (0, cache_1.cacheSet)(cacheKey, episodes, 'episodes');
    return episodes;
}
// Get servers for an episode
async function getDaoServers(episodeId) {
    const res = await ajax.get('/ajax/v2/episode/servers', { params: { episodeId } });
    const html = res.data?.html ?? '';
    const $ = cheerio.load(html);
    const servers = [];
    $('[data-type="sub"] li[data-id], .servers-sub li[data-id]').each((_, el) => {
        const sourceId = $(el).attr('data-id') ?? '';
        const name = $(el).text().trim() || 'Server';
        if (sourceId)
            servers.push({ name, sourceId, type: 'sub' });
    });
    $('[data-type="dub"] li[data-id], .servers-dub li[data-id]').each((_, el) => {
        const sourceId = $(el).attr('data-id') ?? '';
        const name = $(el).text().trim() || 'Server';
        if (sourceId)
            servers.push({ name, sourceId, type: 'dub' });
    });
    return servers;
}
// Get embed URL
async function getDaoEmbedUrl(sourceId) {
    try {
        const res = await ajax.get('/ajax/v2/episode/sources', { params: { id: sourceId } });
        const data = res.data;
        if (data?.link)
            return { embedUrl: data.link, serverName: data.server ?? 'server' };
        if (data?.url)
            return { embedUrl: data.url, serverName: 'server' };
        return null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=anidao.js.map