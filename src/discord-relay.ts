// ── Discord Webhook Relay ─────────────────────────────────────────────────
// Routes:
//   POST /discord/relay       — PHP → Railway → Vercel bot (login/register events)
//   GET  /discord/user-lookup — Vercel bot → Railway → PHP (user profile fetch)
//
// Env vars needed on Railway:
//   VERCEL_BOT_URL = https://anivault-bot.vercel.app
//   BOT_SECRET     = (same secret set on PHP config + Vercel bot)
//   SITE_URL       = https://www.anivault.co

import { Router, Request, Response } from 'express';
import axios from 'axios';
import https from 'https';

// InfinityFree's SSL cert can fail Node's strict verification — bypass it
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

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
            console.error(
                `[discord-relay] Bot returned non-JSON (${response.status}) from ${targetUrl}. ` +
                `Content-Type: ${contentType}. Body preview: ${String(response.data).slice(0, 120)}`
            );
            return res.status(502).json({
                error: 'Bot returned unexpected response',
                status: response.status,
                hint: `Check that ${targetUrl} exists on the bot deployment`,
            });
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
// Bypasses Content-Type sniffing entirely — InfinityFree's PHP doesn't
// always send the correct header, so we fetch as raw text and parse
// the JSON ourselves regardless of what header comes back.
router.get('/user-lookup', async (req: Request, res: Response) => {
    if (req.headers['x-bot-secret'] !== process.env.BOT_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const siteUrl = process.env.SITE_URL || 'https://www.anivault.co';
    const username = req.query.username as string;

    if (!username) {
        return res.status(400).json({ error: 'Missing username' });
    }

    try {
        const response = await axios.get(`${siteUrl}/api/discord_user.php`, {
            params: {
                username,
                secret: process.env.BOT_SECRET,
            },
            timeout: 8000,
            httpsAgent,
            validateStatus: () => true,
            responseType: 'text',
            transformResponse: [(data) => data], // keep raw string, skip axios's auto-JSON
        });

        let parsed: any;
        try {
            parsed = JSON.parse(response.data);
        } catch {
            console.error(
                `[user-lookup] PHP site returned non-JSON (${response.status}). ` +
                `Body preview: ${String(response.data).slice(0, 200)}`
            );
            return res.status(502).json({
                error: 'PHP site returned unexpected response',
                status: response.status,
                bodyPreview: String(response.data).slice(0, 200),
            });
        }

        return res.status(response.status).json(parsed);
    } catch (err: any) {
        console.error('[user-lookup] Failed to reach PHP site:', err?.message);
        return res.status(500).json({ error: 'Relay to PHP site failed', detail: err?.message });
    }
});

export default router;
