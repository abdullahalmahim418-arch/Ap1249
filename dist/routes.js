"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const axios_1 = __importDefault(require("axios"));
const mapper_1 = require("./utils/mapper");
const cache_1 = require("./utils/cache");
const megacloud_1 = require("./resolvers/megacloud");
const senshi_1 = require("./scrapers/senshi");
const anidao_1 = require("./scrapers/anidao");
const aniwaves_1 = require("./scrapers/aniwaves");
const animepahe_1 = require("./scrapers/animepahe");
const router = (0, express_1.Router)();
const SOURCES = ['senshi', 'dao', 'wave', 'animepahe'];
function publicBase(req) {
    const proto = req.headers['x-forwarded-proto']?.split(',')[0] || req.protocol;
    return `${proto}://${req.get('host')}`;
}
function proxiedHlsUrl(req, url) {
    return `${publicBase(req)}/api/proxy/hls?url=${encodeURIComponent(url)}`;
}
function rewriteHlsPlaylist(req, body, sourceUrl) {
    const base = new URL(sourceUrl);
    return body
        .split(/\r?\n/)
        .map((line) => {
        const trimmed = line.trim();
        if (!trimmed)
            return line;
        if (trimmed.startsWith('#EXT-X-KEY') && trimmed.includes('URI=')) {
            return line.replace(/URI="([^"]+)"/, (_m, uri) => {
                const absolute = new URL(uri, base).toString();
                return `URI="${proxiedHlsUrl(req, absolute)}"`;
            });
        }
        if (trimmed.startsWith('#'))
            return line;
        return proxiedHlsUrl(req, new URL(trimmed, base).toString());
    })
        .join('\n');
}
async function resolveAlId(anilistId, malId) {
    if (anilistId)
        return parseInt(anilistId);
    if (malId)
        return (0, mapper_1.malToAnilist)(parseInt(malId));
    return null;
}
async function fetchEpisodes(source, siteIds) {
    const zoroId = siteIds.siteIds?.zoro;
    const paheId = siteIds.siteIds?.animepahe;
    if (source === 'senshi') {
        if (!siteIds.malId)
            return { episodes: [], siteId: '', error: 'Missing MAL ID for Senshi' };
        const senshiId = String(siteIds.malId);
        return { episodes: await (0, senshi_1.getEpisodes)(senshiId), siteId: senshiId };
    }
    if (source === 'dao') {
        if (!zoroId)
            return { episodes: [], siteId: '', error: 'Not indexed on AniDao' };
        return { episodes: await (0, anidao_1.getDaoEpisodes)(zoroId), siteId: zoroId };
    }
    if (source === 'wave') {
        if (!zoroId)
            return { episodes: [], siteId: '', error: 'Not indexed on AniWaves' };
        return { episodes: await (0, aniwaves_1.getWaveEpisodes)(zoroId), siteId: zoroId };
    }
    if (source === 'animepahe') {
        if (!paheId)
            return { episodes: [], siteId: '', error: 'Not indexed on AnimePahe' };
        return { episodes: await (0, animepahe_1.getPaheEpisodes)(paheId), siteId: paheId };
    }
    return { episodes: [], siteId: '', error: 'Unknown source' };
}
// ── GET /api/search
router.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q)
        return res.status(400).json({ error: 'Missing ?q=' });
    try {
        const results = await (0, mapper_1.searchAnilist)(q);
        return res.json({ query: q, count: results.length, results });
    }
    catch (e) {
        return res.status(500).json({ error: 'Search failed', detail: String(e) });
    }
});
// ── GET /api/info
router.get('/info', async (req, res) => {
    const { anilistId, malId } = req.query;
    if (!anilistId && !malId)
        return res.status(400).json({ error: 'Provide ?anilistId= or ?malId=' });
    try {
        const alId = await resolveAlId(anilistId, malId);
        if (!alId)
            return res.status(404).json({ error: 'Anime not found on AniList' });
        const info = await (0, mapper_1.getSiteIds)(alId);
        if (!info)
            return res.status(404).json({ error: 'Could not fetch info' });
        return res.json(info);
    }
    catch (e) {
        return res.status(500).json({ error: String(e) });
    }
});
// ── GET /api/episodes
router.get('/episodes', async (req, res) => {
    const { anilistId, malId, source = 'senshi' } = req.query;
    if (!anilistId && !malId)
        return res.status(400).json({ error: 'Provide ?anilistId= or ?malId=' });
    if (!SOURCES.includes(source))
        return res.status(400).json({ error: `source must be: ${SOURCES.join(', ')}` });
    try {
        const alId = await resolveAlId(anilistId, malId);
        if (!alId)
            return res.status(404).json({ error: 'Anime not found' });
        const siteIds = await (0, mapper_1.getSiteIds)(alId);
        if (!siteIds)
            return res.status(404).json({ error: 'Could not resolve site IDs' });
        const result = await fetchEpisodes(source, siteIds);
        if (result.error)
            return res.status(404).json({ error: result.error });
        return res.json({ anilistId: alId, malId: siteIds.malId, title: siteIds.title, source, siteId: result.siteId, count: result.episodes.length, episodes: result.episodes });
    }
    catch (e) {
        return res.status(500).json({ error: String(e) });
    }
});
// ── GET /api/servers
router.get('/servers', async (req, res) => {
    const { anilistId, malId, ep, type = 'sub', source = 'senshi' } = req.query;
    if (!ep)
        return res.status(400).json({ error: 'Missing ?ep=' });
    if (!anilistId && !malId)
        return res.status(400).json({ error: 'Provide ?anilistId= or ?malId=' });
    const epNum = parseInt(ep);
    if (isNaN(epNum))
        return res.status(400).json({ error: '?ep must be a number' });
    try {
        const alId = await resolveAlId(anilistId, malId);
        if (!alId)
            return res.status(404).json({ error: 'Anime not found' });
        const siteIds = await (0, mapper_1.getSiteIds)(alId);
        if (!siteIds)
            return res.status(404).json({ error: 'Could not resolve site IDs' });
        const epResult = await fetchEpisodes(source, siteIds);
        if (epResult.error)
            return res.status(404).json({ error: epResult.error });
        const episode = epResult.episodes.find((e) => e.num === epNum);
        if (!episode)
            return res.status(404).json({ error: `Episode ${epNum} not found` });
        let allServers = [];
        if (source === 'senshi')
            allServers = await (0, senshi_1.getServers)(episode.id);
        if (source === 'dao')
            allServers = await (0, anidao_1.getDaoServers)(episode.id);
        if (source === 'wave')
            allServers = await (0, aniwaves_1.getWaveServers)(episode.id);
        const filtered = type === 'all' ? allServers : allServers.filter((s) => s.type === type);
        return res.json({ anilistId: alId, malId: siteIds.malId, title: siteIds.title, episode: epNum, type, source, servers: filtered.map((s) => ({ name: s.name, sourceId: s.sourceId, type: s.type })) });
    }
    catch (e) {
        return res.status(500).json({ error: String(e) });
    }
});
// ── Named handler shared by both route styles
async function watchHandler(req, res) {
    const { source, id, ep, type } = req.params;
    const preferredServer = req.query.server;
    if (!SOURCES.includes(source))
        return res.status(400).json({ error: `source must be: ${SOURCES.join(', ')}` });
    const epNum = parseInt(ep);
    if (isNaN(epNum))
        return res.status(400).json({ error: 'ep must be a number' });
    if (!['sub', 'dub', 'raw'].includes(type))
        return res.status(400).json({ error: 'type must be: sub, dub, raw' });
    const anilistId = id.startsWith('mal-') ? undefined : id;
    const malId = id.startsWith('mal-') ? id.replace('mal-', '') : undefined;
    try {
        const alId = await resolveAlId(anilistId, malId);
        if (!alId)
            return res.status(404).json({ error: 'Anime not found on AniList' });
        const siteIds = await (0, mapper_1.getSiteIds)(alId);
        if (!siteIds)
            return res.status(404).json({ error: 'Could not resolve anime' });
        // AnimePahe special flow
        if (source === 'animepahe') {
            const paheId = siteIds.siteIds?.animepahe;
            if (!paheId)
                return res.status(404).json({ error: 'Not on AnimePahe' });
            // Paginate: AnimePahe returns 30 eps per page
            const page = Math.ceil(epNum / 30);
            const episodes = await (0, animepahe_1.getPaheEpisodes)(paheId, page);
            // AnimePahe returns num as float (1.0) — match loosely
            const episode = episodes.find((e) => Math.round(e.num) === epNum);
            if (!episode)
                return res.status(404).json({ error: `Episode ${epNum} not found (page ${page})` });
            const embeds = await (0, animepahe_1.getPaheEmbeds)(paheId, episode.session);
            return res.json({ anilistId: alId, malId: siteIds.malId, title: siteIds.title, episode: epNum, type, source: 'animepahe', servers: embeds, note: 'AnimePahe uses Kwik embeds — iframe directly or resolve with kwik extractor' });
        }
        // Zoro-style flow
        const epResult = await fetchEpisodes(source, siteIds);
        if (epResult.error)
            return res.status(404).json({ error: epResult.error });
        const episode = epResult.episodes.find((e) => e.num === epNum);
        if (!episode)
            return res.status(404).json({ error: `Episode ${epNum} not found` });
        let allServers = [];
        if (source === 'senshi')
            allServers = await (0, senshi_1.getServers)(episode.id);
        if (source === 'dao')
            allServers = await (0, anidao_1.getDaoServers)(episode.id);
        if (source === 'wave')
            allServers = await (0, aniwaves_1.getWaveServers)(episode.id);
        let filtered = allServers.filter((s) => s.type === type);
        if (!filtered.length)
            filtered = allServers.filter((s) => s.type === 'sub');
        if (!filtered.length)
            return res.status(404).json({ error: `No servers found for ep ${epNum}` });
        // Sort by preferred server
        if (preferredServer) {
            filtered.sort((a, b) => {
                const aM = a.name.toLowerCase().includes(preferredServer.toLowerCase()) ? -1 : 1;
                const bM = b.name.toLowerCase().includes(preferredServer.toLowerCase()) ? -1 : 1;
                return aM - bM;
            });
        }
        let embedResult = null;
        let usedServer = '';
        for (const server of filtered) {
            let raw = null;
            if (source === 'senshi')
                raw = await (0, senshi_1.getEmbedUrl)(server.sourceId);
            if (source === 'dao')
                raw = await (0, anidao_1.getDaoEmbedUrl)(server.sourceId);
            if (source === 'wave')
                raw = await (0, aniwaves_1.getWaveEmbedUrl)(server.sourceId);
            if (raw) {
                embedResult = raw;
                usedServer = server.name;
                break;
            }
        }
        if (!embedResult)
            return res.status(502).json({ error: 'All servers failed' });
        const directM3u8 = typeof embedResult.embedUrl === 'string' && embedResult.embedUrl.includes('.m3u8');
        const stream = directM3u8 ? null : await (0, megacloud_1.resolveEmbed)(embedResult.embedUrl);
        const m3u8 = directM3u8 ? embedResult.embedUrl : stream?.m3u8 ?? null;
        const playbackMode = m3u8 ? 'hls' : 'iframe';
        return res.json({
            anilistId: alId, malId: siteIds.malId, title: siteIds.title,
            episode: epNum, type, source, server: usedServer,
            availableServers: filtered.map((s) => s.name),
            embedUrl: embedResult.embedUrl,
            m3u8,
            hlsProxyUrl: directM3u8 ? proxiedHlsUrl(req, embedResult.embedUrl) : null,
            playbackMode,
            iframeOnly: playbackMode === 'iframe',
            subtitles: stream?.subtitles ?? [],
            intro: stream?.intro ?? null,
            outro: stream?.outro ?? null,
            note: playbackMode === 'hls' ? null : 'This source exposes an iframe embed only; no direct HLS URL is available from the public source response.',
        });
    }
    catch (e) {
        console.error(`[/watch/${source}]`, e);
        return res.status(500).json({ error: 'Stream fetch failed', detail: String(e) });
    }
}
router.get('/watch/:source/:id/:ep/:type', watchHandler);
router.get('/proxy/hls', async (req, res) => {
    const url = req.query.url;
    if (!url)
        return res.status(400).json({ error: 'Missing ?url=' });
    if (!/^https?:\/\//i.test(url))
        return res.status(400).json({ error: '?url must be absolute http(s)' });
    try {
        const upstream = await axios_1.default.get(url, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': '*/*',
                'Referer': 'https://senshi.live/',
                'Origin': 'https://senshi.live',
            },
        });
        const contentType = String(upstream.headers['content-type'] ?? '');
        const body = Buffer.from(upstream.data);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=30');
        if (url.includes('.m3u8') || contentType.includes('mpegurl')) {
            res.type('application/vnd.apple.mpegurl');
            return res.send(rewriteHlsPlaylist(req, body.toString('utf8'), url));
        }
        res.type(contentType || 'application/octet-stream');
        return res.send(body);
    }
    catch (e) {
        return res.status(e?.response?.status || 502).json({ error: 'HLS proxy failed', detail: e?.message || String(e) });
    }
});
// ── GET /api/watch (query-param compat)
router.get('/watch', async (req, res) => {
    const { anilistId, malId, ep, type = 'sub', source = 'senshi', server } = req.query;
    if (!ep)
        return res.status(400).json({ error: 'Missing ?ep=' });
    if (!anilistId && !malId)
        return res.status(400).json({ error: 'Provide ?anilistId= or ?malId=' });
    const id = anilistId ? String(anilistId) : `mal-${malId}`;
    // Reuse path handler logic by reassigning params and calling it inline
    req.params.source = String(source);
    req.params.id = id;
    req.params.ep = String(ep);
    req.params.type = String(type);
    if (server)
        req.query.server = server;
    return watchHandler(req, res);
});
// ── GET /api/health
router.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0', sources: SOURCES, uptime: Math.floor(process.uptime()), cache: (0, cache_1.cacheStats)(), timestamp: new Date().toISOString() });
});
exports.default = router;
//# sourceMappingURL=routes.js.map