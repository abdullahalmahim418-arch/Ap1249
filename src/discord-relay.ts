// ── Discord Webhook Relay ─────────────────────────────────────────────────
// InfinityFree (where the PHP site lives) blocks outbound curl to external
// domains. Since PHP can already reach Railway, this endpoint acts as a
// middleman: PHP → Railway → Vercel bot → Discord.
//
// Setup: add these two env vars in Railway dashboard:
//   VERCEL_BOT_URL  = https://anivault-bot.vercel.app
//   BOT_SECRET      = (same random string you set in Vercel env vars)

import { Router, Request, Response } from 'express';
import axios from 'axios';

const router = Router();

router.post('/relay', async (req: Request, res: Response) => {
    // Validate the request came from your PHP site
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

export default router;
