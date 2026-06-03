import { Router, Request, Response } from 'express';
import { malToAnilist, getSiteIds, searchAnilist } from './utils/mapper';
import { cacheStats } from './utils/cache';
import { resolveEmbed } from './resolvers/megacloud';

import { getEpisodes, getServers, getEmbedUrl } from './scrapers/senshi';
import { getDaoEpisodes, getDaoServers, getDaoEmbedUrl } from './scrapers/anidao';
import { getWaveEpisodes, getWaveServers, getWaveEmbedUrl } from './scrapers/aniwaves';
import { searchAnimePahe, getPaheEpisodes, getPaheEmbeds } from './scrapers/animepahe';

const router = Router();

const SOURCES = ['senshi', 'dao', 'wave', 'animepahe'] as const;
type Source = typeof SOURCES[number];

async function resolveAlId(anilistId?: string, malId?: string): Promise<number | null> {
  if (anilistId) return parseInt(anilistId);
  if (malId) return malToAnilist(parseInt(malId));
  return null;
}

async function fetchEpisodes(source: Source, siteIds: any): Promise<{ episodes: any[]; siteId: string; error?: string }> {
  const senshiId = (siteIds.siteIds?.senshi ?? siteIds.siteIds?.zoro) as string | undefined;
  const daoId = (siteIds.siteIds?.anidao ?? siteIds.siteIds?.zoro) as string | undefined;
  const waveId = (siteIds.siteIds?.wave ?? siteIds.siteIds?.zoro) as string | undefined;
  const paheId = siteIds.siteIds?.animepahe as string | undefined;

  if (source === 'senshi') {
    if (!senshiId) return { episodes: [], siteId: '', error: 'Not indexed on Senshi' };
    return { episodes: await getEpisodes(senshiId), siteId: senshiId };
  }
  if (source === 'dao') {
    if (!daoId) return { episodes: [], siteId: '', error: 'Not indexed on AniDao' };
    return { episodes: await getDaoEpisodes(daoId), siteId: daoId };
  }
  if (source === 'wave') {
    if (!waveId) return { episodes: [], siteId: '', error: 'Not indexed on AniWaves' };
    return { episodes: await getWaveEpisodes(waveId), siteId: waveId };
  }
  if (source === 'animepahe') {
    if (!paheId) return { episodes: [], siteId: '', error: 'Not indexed on AnimePahe' };
    return { episodes: await getPaheEpisodes(paheId), siteId: paheId };
  }
  return { episodes: [], siteId: '', error: 'Unknown source' };
}

// ── GET /api/search
router.get('/search', async (req: Request, res: Response) => {
  const q = req.query.q as string;
  if (!q) return res.status(400).json({ error: 'Missing ?q=' });
  try {
    const results = await searchAnilist(q);
    return res.json({ query: q, count: results.length, results });
  } catch (e) {
    return res.status(500).json({ error: 'Search failed', detail: String(e) });
  }
});

// ── GET /api/info
router.get('/info', async (req: Request, res: Response) => {
  const { anilistId, malId } = req.query;
  if (!anilistId && !malId) return res.status(400).json({ error: 'Provide ?anilistId= or ?malId=' });
  try {
    const alId = await resolveAlId(anilistId as string, malId as string);
    if (!alId) return res.status(404).json({ error: 'Anime not found on AniList' });
    const info = await getSiteIds(alId);
    if (!info) return res.status(404).json({ error: 'Could not fetch info' });
    return res.json(info);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/episodes
router.get('/episodes', async (req: Request, res: Response) => {
  const { anilistId, malId, source = 'senshi' } = req.query;
  if (!anilistId && !malId) return res.status(400).json({ error: 'Provide ?anilistId= or ?malId=' });
  if (!SOURCES.includes(source as Source)) return res.status(400).json({ error: `source must be: ${SOURCES.join(', ')}` });
  try {
    const alId = await resolveAlId(anilistId as string, malId as string);
    if (!alId) return res.status(404).json({ error: 'Anime not found' });
    const siteIds = await getSiteIds(alId);
    if (!siteIds) return res.status(404).json({ error: 'Could not resolve site IDs' });
    const result = await fetchEpisodes(source as Source, siteIds);
    if (result.error) return res.status(404).json({ error: result.error });
    return res.json({ anilistId: alId, malId: siteIds.malId, title: siteIds.title, source, siteId: result.siteId, count: result.episodes.length, episodes: result.episodes });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// ── GET /api/servers
router.get('/servers', async (req: Request, res: Response) => {
  const { anilistId, malId, ep, type = 'sub', source = 'senshi' } = req.query;
  if (!ep) return res.status(400).json({ error: 'Missing ?ep=' });
  if (!anilistId && !malId) return res.status(400).json({ error: 'Provide ?anilistId= or ?malId=' });
  const epNum = parseInt(ep as string);
  if (isNaN(epNum)) return res.status(400).json({ error: '?ep must be a number' });
  try {
    const alId = await resolveAlId(anilistId as string, malId as string);
    if (!alId) return res.status(404).json({ error: 'Anime not found' });
    const siteIds = await getSiteIds(alId);
    if (!siteIds) return res.status(404).json({ error: 'Could not resolve site IDs' });
    const epResult = await fetchEpisodes(source as Source, siteIds);
    if (epResult.error) return res.status(404).json({ error: epResult.error });
    const episode = epResult.episodes.find((e: any) => e.num === epNum);
    if (!episode) return res.status(404).json({ error: `Episode ${epNum} not found` });

    let allServers: any[] = [];
    if (source === 'senshi') allServers = await getServers(episode.id);
    if (source === 'dao')    allServers = await getDaoServers(episode.id);
    if (source === 'wave')   allServers = await getWaveServers(episode.id);

    const filtered = type === 'all' ? allServers : allServers.filter((s: any) => s.type === type);
    return res.json({ anilistId: alId, malId: siteIds.malId, title: siteIds.title, episode: epNum, type, source, servers: filtered.map((s: any) => ({ name: s.name, sourceId: s.sourceId, type: s.type })) });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// ── Named handler shared by both route styles
async function watchHandler(req: Request, res: Response) {
  const { source, id, ep, type } = req.params;
  const preferredServer = req.query.server as string | undefined;

  if (!SOURCES.includes(source as Source)) return res.status(400).json({ error: `source must be: ${SOURCES.join(', ')}` });
  const epNum = parseInt(ep);
  if (isNaN(epNum)) return res.status(400).json({ error: 'ep must be a number' });
  if (!['sub', 'dub', 'raw'].includes(type)) return res.status(400).json({ error: 'type must be: sub, dub, raw' });

  const anilistId = id.startsWith('mal-') ? undefined : id;
  const malId = id.startsWith('mal-') ? id.replace('mal-', '') : undefined;

  try {
    const alId = await resolveAlId(anilistId, malId);
    if (!alId) return res.status(404).json({ error: 'Anime not found on AniList' });
    const siteIds = await getSiteIds(alId);
    if (!siteIds) return res.status(404).json({ error: 'Could not resolve anime' });

    // AnimePahe special flow
    if (source === 'animepahe') {
      const paheId = siteIds.siteIds?.animepahe;
      if (!paheId) return res.status(404).json({ error: 'Not on AnimePahe' });
      const episodes = await getPaheEpisodes(paheId);
      const episode = episodes.find((e: any) => e.num === epNum);
      if (!episode) return res.status(404).json({ error: `Episode ${epNum} not found` });
      const embeds = await getPaheEmbeds(paheId, (episode as any).session);
      return res.json({ anilistId: alId, malId: siteIds.malId, title: siteIds.title, episode: epNum, type, source: 'animepahe', servers: embeds, note: 'AnimePahe uses Kwik embeds — iframe directly or resolve with kwik extractor' });
    }

    // Zoro-style flow
    const epResult = await fetchEpisodes(source as Source, siteIds);
    if (epResult.error) return res.status(404).json({ error: epResult.error });

    const episode = epResult.episodes.find((e: any) => e.num === epNum);
    if (!episode) return res.status(404).json({ error: `Episode ${epNum} not found` });

    let allServers: any[] = [];
    if (source === 'senshi') allServers = await getServers(episode.id);
    if (source === 'dao')    allServers = await getDaoServers(episode.id);
    if (source === 'wave')   allServers = await getWaveServers(episode.id);

    let filtered = allServers.filter((s: any) => s.type === type);
    if (!filtered.length) filtered = allServers.filter((s: any) => s.type === 'sub');
    if (!filtered.length) return res.status(404).json({ error: `No servers found for ep ${epNum}` });

    // Sort by preferred server
    if (preferredServer) {
      filtered.sort((a: any, b: any) => {
        const aM = a.name.toLowerCase().includes(preferredServer.toLowerCase()) ? -1 : 1;
        const bM = b.name.toLowerCase().includes(preferredServer.toLowerCase()) ? -1 : 1;
        return aM - bM;
      });
    }

    let embedResult: any = null;
    let usedServer = '';
    for (const server of filtered) {
      let raw: any = null;
      if (source === 'senshi') raw = await getEmbedUrl(server.sourceId);
      if (source === 'dao')    raw = await getDaoEmbedUrl(server.sourceId);
      if (source === 'wave')   raw = await getWaveEmbedUrl(server.sourceId);
      if (raw) { embedResult = raw; usedServer = server.name; break; }
    }
    if (!embedResult) return res.status(502).json({ error: 'All servers failed' });

    const stream = await resolveEmbed(embedResult.embedUrl);
    return res.json({
      anilistId: alId, malId: siteIds.malId, title: siteIds.title,
      episode: epNum, type, source, server: usedServer,
      availableServers: filtered.map((s: any) => s.name),
      embedUrl: embedResult.embedUrl,
      m3u8: stream?.m3u8 ?? null,
      subtitles: stream?.subtitles ?? [],
      intro: stream?.intro ?? null,
      outro: stream?.outro ?? null,
      note: stream ? null : 'Use embedUrl in iframe — m3u8 decrypt failed (key may have rotated)',
    });
  } catch (e) {
    console.error(`[/watch/${source}]`, e);
    return res.status(500).json({ error: 'Stream fetch failed', detail: String(e) });
  }
}

router.get('/watch/:source/:id/:ep/:type', watchHandler);

// ── GET /api/watch (query-param compat)
router.get('/watch', async (req: Request, res: Response) => {
  const { anilistId, malId, ep, type = 'sub', source = 'senshi', server } = req.query;
  if (!ep) return res.status(400).json({ error: 'Missing ?ep=' });
  if (!anilistId && !malId) return res.status(400).json({ error: 'Provide ?anilistId= or ?malId=' });
  const id = anilistId ? String(anilistId) : `mal-${malId}`;
  // Reuse path handler logic by reassigning params and calling it inline
  req.params.source = String(source);
  req.params.id = id;
  req.params.ep = String(ep);
  req.params.type = String(type);
  if (server) req.query.server = server;
  return watchHandler(req, res);
});

// ── GET /api/health
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', sources: SOURCES, uptime: Math.floor(process.uptime()), cache: cacheStats(), timestamp: new Date().toISOString() });
});

export default router;
