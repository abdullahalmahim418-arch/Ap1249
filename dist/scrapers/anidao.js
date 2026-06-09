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
function normalizeAnimeId(animeId) {
    return animeId.replace(/-\d+$/, '');
}
function serverType(raw) {
    const value = raw.toLowerCase();
    if (value.includes('dub'))
        return 'dub';
    if (value.includes('raw'))
        return 'raw';
    return 'sub';
}
async function searchAniDao(query) {
    const res = await http.get('/search.html', { params: { keyword: query } });
    const $ = cheerio.load(res.data);
    const results = [];
    $('a[href^="/anime/"]').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        const title = $(el).find('[data-an-name-en], .name, h3').first().text().trim() || $(el).text().trim();
        const id = href.split('/').filter(Boolean).pop()?.split('?')[0] ?? '';
        if (title && id && !results.some((r) => r.id === id))
            results.push({ title, id, url: BASE + href });
    });
    return results;
}
async function getDaoEpisodes(animeId) {
    const slug = normalizeAnimeId(animeId);
    const cacheKey = `dao:eps:${slug}`;
    const cached = (0, cache_1.cacheGet)(cacheKey);
    if (cached)
        return cached;
    const res = await http.get(`/anime/${slug}`);
    const $ = cheerio.load(res.data);
    const episodes = [];
    $('a[href^="/watch-online/"]').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        const match = href.match(/episode-(\d+(?:\.\d+)?)/i);
        const num = match ? Number(match[1]) : 0;
        const title = $(el).find('.title, .name').first().text().trim() || `Episode ${num}`;
        if (num > 0 && !episodes.some((ep) => ep.num === num)) {
            episodes.push({ num, id: href, title });
        }
    });
    episodes.sort((a, b) => a.num - b.num);
    if (episodes.length > 0)
        (0, cache_1.cacheSet)(cacheKey, episodes, 'episodes');
    return episodes;
}
async function getDaoServers(episodeId) {
    if (episodeId.startsWith('/watch-online/')) {
        const res = await http.get(episodeId);
        const $ = cheerio.load(res.data);
        const servers = [];
        $('[data-an-video]').each((_, el) => {
            const sourceId = $(el).attr('data-an-video') ?? '';
            const group = $(el).closest('[data-an-panel]').attr('data-an-panel') ?? '';
            const label = $(el).text().replace(/\s+/g, ' ').trim();
            const name = label || $(el).attr('data-an-server-btn') || 'Server';
            if (sourceId)
                servers.push({ name, sourceId, type: serverType(group || name) });
        });
        return servers;
    }
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
async function getDaoEmbedUrl(sourceId) {
    if (/^https?:\/\//i.test(sourceId))
        return { embedUrl: sourceId, serverName: new URL(sourceId).hostname };
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