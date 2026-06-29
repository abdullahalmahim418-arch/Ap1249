// ── Discord Webhook Relay ─────────────────────────────────────────────────
// InfinityFree (where the PHP site lives) blocks outbound curl to external
// domains. PHP → this relay → anivault-bot.vercel.app/api/event → Discord.
//
// Env vars needed (set in Vercel dashboard for the scraper deployment):
//   VERCEL_BOT_URL  = https://anivault-bot.vercel.app
//   BOT_SECRET      = (same secret set on the bot deployment)

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
            // Don't let axios throw on 4xx/5xx — we'll handle it below
            validateStatus: () => true,
        });

        const contentType = String(response.headers['content-type'] || '');

        // If bot returned HTML instead of JSON, it means the route doesn't exist
        // or Vercel returned a fallback/error page — surface a clear error
        if (!contentType.includes('application/json')) {
            console.error(
                `[discord-relay] Bot returned non-JSON (${response.status}) from ${targetUrl}. ` +
                `Content-Type: ${contentType}. ` +
                `Body preview: ${String(response.data).slice(0, 120)}`
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

export default router;
