// ── Discord Webhook Relay ─────────────────────────────────────────────────
// InfinityFree blocks outbound curl to external domains, and also blocks
// inbound requests from cloud servers like Vercel.
// So all traffic routes through Railway as a middleman.
//
// Routes:
//   POST /discord/relay       — PHP → Railway → Vercel bot (login/register events)
//   GET  /discord/user-lookup — Vercel bot → Railway → PHP (user profile fetch)
//
// Required Railway env vars:
//   VERCEL_BOT_URL  = https://your-bot.vercel.app
//   BOT_SECRET      = (same string in Vercel + PHP config)
//   SITE_URL        = https://www.anivault.co

import { Router, Request, Response } from 'express';
import axios from 'axios';
import https from 'https';

// InfinityFree uses a self-signed / unverifiable SSL cert — bypass verification
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const router = Router();

// ── POST /discord/relay ───────────────────────────────────────
// PHP site → Railway → Vercel bot (login/register notifications)
router.post('/relay', async (req: Request, res: Response) => {
    if (req.headers['x-bot-secret'] !== process.env.BOT_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const vercelUrl = process.env.VERCEL_BOT_URL;
    if (!vercelUrl) {
        return res.status(500).json({ error: 'VERCEL_BOT_URL not set in Railway env vars' });
    }

    try {
        const response = await axios.post(`${vercelUrl}/api/event`, req.body, {
            headers: {
                'Content-Type': 'application/json',
                'x-bot-secret': process.env.BOT_SECRET!,
            },
            timeout: 8000,
        });
        return res.json(response.data);
    } catch (err: any) {
        console.error('[discord-relay] Failed to reach Vercel bot:', err?.message);
        return res.status(500).json({ error: 'Relay failed' });
    }
});

// ── GET /discord/user-lookup ──────────────────────────────────
// Vercel bot → Railway → PHP site (user profile + stats lookup)
// InfinityFree blocks Vercel's IPs, but allows Railway — so the
// bot calls Railway, Railway calls the PHP site, returns the data.
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
        });
        return res.status(response.status).json(response.data);
    } catch (err: any) {
        const status = err?.response?.status || 500;
        const data   = err?.response?.data   || { error: 'Relay to PHP site failed' };
        console.error('[user-lookup] Failed:', err?.message);
        return res.status(status).json(data);
    }
});

export default router;
