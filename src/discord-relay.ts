// ── Discord Webhook Relay ─────────────────────────────────────────────────
// Routes:
//   POST /discord/relay       — PHP → Railway → Vercel bot (login/register events)
//   GET  /discord/user-lookup — Vercel bot → Railway → PHP (user profile fetch)
//
// InfinityFree wraps requests that don't look like real browser sessions in
// an AES/JS cookie challenge (like Cloudflare's, but InfinityFree's own).
// We use the same FlareSolverr instance already running for Senshi to solve
// it and cache the resulting cookie for reuse.
//
// Env vars needed on Railway:
//   VERCEL_BOT_URL    = https://anivault-bot.vercel.app
//   BOT_SECRET        = (same secret set on PHP config + Vercel bot)
//   SITE_URL          = https://www.anivault.co
//   FLARESOLVERR_URL  = https://anivault-flaresolverr.onrender.com

import { Router, Request, Response } from 'express';
import axios from 'axios';
import https from 'https';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || '';

// Cache InfinityFree's anti-bot cookie + UA for ~25 minutes per domain
let ifCache: { cookies: string; userAgent: string; expiresAt: number } | null = null;

async function getInfinityFreeClearance(siteUrl: string): Promise<{ cookies: string; userAgent: string } | null> {
    if (!FLARESOLVERR_URL) return null;

    if (ifCache && ifCache.expiresAt > Date.now()) {
        console.log(`[user-lookup] Using cached InfinityFree cookies (expires in ${Math.round((ifCache.expiresAt - Date.now()) / 1000)}s)`);
        return ifCache;
    }

    console.log('[user-lookup] Solving InfinityFree challenge via FlareSolverr...');
    try {
        const res = await axios.post(`${FLARESOLVERR_URL}/v1`, {
            cmd: 'request.get',
            url: siteUrl,
            maxTimeout: 60000,
        }, { timeout: 70000 });

        const solution = res.data?.solution;
        if (!solution) return null;

        const cookies = (solution.cookies as any[])
            .map((c: any) => `${c.name}=${c.value}`)
            .join('; ');

        ifCache = { cookies, userAgent: solution.userAgent, expiresAt: Date.now() + 25 * 60 * 1000 };
        console.log('[user-lookup] ✅ InfinityFree cookies cached for 25 minutes');
        return ifCache;
    } catch (e: any) {
        console.error('[user-lookup] FlareSolverr failed:', e?.message);
        return null;
    }
}

const router = Router();

// ── POST /discord/relay ───────────────────────────────────────
router.post('/relay', async (req: Request, res: Response) => {
    if (req.headers['x-bot-secret'] !== process.env.BOT_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const vercelUrl = process.env.VERCEL_BOT_URL;
    if (!vercelUrl) {
        return res.status(500).json({ error: 'VERCEL_BOT_URL not configured' });
    }

    const targetUrl = `${vercelUrl}/api/event`;

    try {
        const response = await axios.post(targetUrl, req.body, {
            headers: {
                'Content-Type': 'application/json',
                'x-bot-secret': process.env.BOT_SECRET!,
            },
            timeout: 8000,
            validateStatus: () => true,
        });

        const contentType = String(response.headers['content-type'] || '');

        if (!contentType.includes('application/json')) {
            console.error(`[discord-relay] Bot returned non-JSON (${response.status}) from ${targetUrl}.`);
            return res.status(502).json({ error: 'Bot returned unexpected response', status: response.status });
        }

        if (response.status >= 400) {
            console.error(`[discord-relay] Bot returned ${response.status}:`, response.data);
            return res.status(response.status).json(response.data);
        }

        return res.json(response.data);

    } catch (err: any) {
        console.error('[discord-relay] Network error reaching bot:', err?.message);
        return res.status(500).json({ error: 'Relay failed', detail: err?.message });
    }
});

// ── GET /discord/user-lookup ──────────────────────────────────
router.get('/user-lookup', async (req: Request, res: Response) => {
    if (req.headers['x-bot-secret'] !== process.env.BOT_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const siteUrl = process.env.SITE_URL || 'https://www.anivault.co';
    const username = req.query.username as string;

    if (!username) {
        return res.status(400).json({ error: 'Missing username' });
    }

    const apiUrl = `${siteUrl}/api/discord_user.php?username=${encodeURIComponent(username)}&secret=${process.env.BOT_SECRET}`;

    const clearance = await getInfinityFreeClearance(siteUrl);

    try {
        const response = await axios.get(apiUrl, {
            timeout: 15000,
            httpsAgent,
            headers: clearance ? {
                'Cookie': clearance.cookies,
                'User-Agent': clearance.userAgent,
            } : {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            },
            validateStatus: () => true,
            responseType: 'text',
            transformResponse: [(data) => data],
        });

        let parsed: any;
        try {
            parsed = JSON.parse(response.data);
        } catch {
            console.error(
                `[user-lookup] Still non-JSON (${response.status}) even after FlareSolverr. ` +
                `Body preview: ${String(response.data).slice(0, 200)}`
            );
            // Clear cache so next attempt re-solves
            ifCache = null;
            return res.status(502).json({
                error: 'PHP site returned unexpected response',
                status: response.status,
            });
        }

        return res.status(response.status).json(parsed);
    } catch (err: any) {
        console.error('[user-lookup] Failed to reach PHP site:', err?.message);
        return res.status(500).json({ error: 'Relay to PHP site failed', detail: err?.message });
    }
});

export default router;
