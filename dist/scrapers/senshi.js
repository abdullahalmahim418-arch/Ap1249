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
exports.searchSenshi = searchSenshi;
exports.getEpisodes = getEpisodes;
exports.getServers = getServers;
exports.getEmbedUrl = getEmbedUrl;
const cheerio = __importStar(require("cheerio"));
const fetch_1 = require("../utils/fetch");
const cache_1 = require("../utils/cache");
const BASE = 'https://senshi.live';
const http = (0, fetch_1.makeClient)(BASE, BASE + '/');
const ajax = (0, fetch_1.makeAjaxClient)(BASE, BASE + '/');
// Legacy search kept for compatibility with callers that import it directly.
async function searchSenshi(query) {
    const res = await http.get('/search', { params: { keyword: query } });
    const $ = cheerio.load(res.data);
    const results = [];
    $('.flw-item .film-name a, [class*="film-detail"] h3 a').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        const title = $(el).text().trim();
        const id = href.split('/').filter(Boolean).pop()?.split('?')[0] ?? '';
        if (title && id)
            results.push({ title, id, url: BASE + href });
    });
    return results;
}
async function getEpisodes(animeId) {
    const cacheKey = `senshi:eps:${animeId}`;
    const cached = (0, cache_1.cacheGet)(cacheKey);
    if (cached)
        return cached;
    const res = await http.get(`/episodes/${animeId}`, {
        headers: { Accept: 'application/json' },
    });
    const rows = Array.isArray(res.data) ? res.data : [];
    const episodes = rows
        .map((ep) => {
        const num = Number(ep.ep_id ?? ep.episode_number ?? ep.num);
        return {
            num,
            id: `${animeId}:${num}`,
            title: ep.ep_title ?? `Episode ${num}`,
        };
    })
        .filter((ep) => ep.num > 0);
    if (episodes.length > 0)
        (0, cache_1.cacheSet)(cacheKey, episodes, 'episodes');
    return episodes;
}
async function getServers(episodeId) {
    if (episodeId.includes(':')) {
        const [animeId, epNum] = episodeId.split(':');
        const res = await http.get(`/episode-embeds/${animeId}/${epNum}`, {
            headers: { Accept: 'application/json' },
        });
        const embeds = Array.isArray(res.data) ? res.data : [];
        return embeds
            .map((embed, index) => {
            const status = String(embed.status ?? '').toLowerCase();
            const type = status.includes('dub') ? 'dub' : status.includes('raw') ? 'raw' : 'sub';
            const name = embed.status || `Server ${index + 1}`;
            const sourceId = embed.url || embed.server2 || embed.serverFM || '';
            return sourceId ? { name, serverId: String(index + 1), sourceId, type } : null;
        })
            .filter(Boolean);
    }
    const res = await ajax.get('/ajax/v2/episode/servers', {
        params: { episodeId },
    });
    const html = (res.data?.html || (typeof res.data === 'string' ? res.data : ''));
    const $ = cheerio.load(html);
    const servers = [];
    $('[data-type="sub"] .server-item, .servers-sub .item, [class*="sub"] li[data-id]').each((_, el) => {
        const sourceId = $(el).attr('data-id') ?? '';
        const serverId = $(el).attr('data-server-id') ?? '';
        const name = $(el).text().trim() || 'Server';
        if (sourceId)
            servers.push({ name, serverId, sourceId, type: 'sub' });
    });
    $('[data-type="dub"] .server-item, .servers-dub .item, [class*="dub"] li[data-id]').each((_, el) => {
        const sourceId = $(el).attr('data-id') ?? '';
        const serverId = $(el).attr('data-server-id') ?? '';
        const name = $(el).text().trim() || 'Server';
        if (sourceId)
            servers.push({ name, serverId, sourceId, type: 'dub' });
    });
    $('[data-type="raw"] .server-item, .servers-raw .item, [class*="raw"] li[data-id]').each((_, el) => {
        const sourceId = $(el).attr('data-id') ?? '';
        const serverId = $(el).attr('data-server-id') ?? '';
        const name = $(el).text().trim() || 'Server';
        if (sourceId)
            servers.push({ name, serverId, sourceId, type: 'raw' });
    });
    return servers;
}
async function getEmbedUrl(sourceId) {
    if (/^https?:\/\//i.test(sourceId)) {
        return {
            embedUrl: sourceId,
            serverName: 'Senshi',
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
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=senshi.js.map