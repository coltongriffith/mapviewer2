// Welcome email for captured leads (people who exported a map / left an email).
//
// SHIPS INERT: with no RESEND_API_KEY secret set, this no-ops and returns
// { skipped }, so the client-side invoke is safe to ship before email is
// configured. To activate:
//   1. Create a Resend account and verify your sending domain.
//   2. supabase secrets set RESEND_API_KEY=re_xxx WELCOME_FROM="Exploration Maps <hello@explorationmaps.com>"
//   3. supabase functions deploy send-welcome
//   4. Run supabase-leads-welcome-setup.sql (adds leads.welcomed_at + the
//      conversion view used for dedupe and admin reporting).
//
// Swap Resend for Loops/Postmark/etc. by changing the fetch block below.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('WELCOME_FROM') ?? 'Exploration Maps <hello@explorationmaps.com>';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function welcomeHtml() {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1e293b;line-height:1.6">
    <h1 style="font-size:20px;color:#0f172a">Your map is ready to build on.</h1>
    <p>Thanks for trying Exploration Maps. You just exported a map — here's what else you can do with the same project:</p>
    <ul>
      <li><strong>Search live claim registries</strong> (BC, Ontario, Quebec, Saskatchewan, Manitoba, Newfoundland &amp; Labrador, Yukon) and drop a company's claims straight onto the map.</li>
      <li><strong>Add drill results, targets, and infrastructure</strong>, then style them with one click.</li>
      <li><strong>Export NI 43-101-ready figures</strong> with scale bar, north arrow, and legend.</li>
    </ul>
    <p><a href="https://www.explorationmaps.com/" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open your maps →</a></p>
    <p style="font-size:12px;color:#64748b">You're receiving this because you exported a map at explorationmaps.com. Reply to this email if you'd rather not hear from us.</p>
  </div>`;
}

Deno.serve(async (req) => {
  try {
    const { email } = await req.json().catch(() => ({}));
    if (!email || typeof email !== 'string') return json({ error: 'email required' }, 400);
    const addr = email.trim().toLowerCase();

    // Inert until configured — safe to call from the client before setup.
    if (!RESEND_API_KEY) return json({ skipped: 'no RESEND_API_KEY configured' });

    const db = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Dedupe: only welcome an address once (requires leads.welcomed_at).
    const { data: prior } = await db
      .from('leads')
      .select('id')
      .eq('email', addr)
      .not('welcomed_at', 'is', null)
      .limit(1);
    if (prior && prior.length) return json({ skipped: 'already welcomed' });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: addr,
        subject: 'Your Exploration Maps export — and what else you can make',
        html: welcomeHtml(),
      }),
    });
    if (!res.ok) return json({ error: `resend ${res.status}: ${await res.text()}` }, 502);

    await db.from('leads').update({ welcomed_at: new Date().toISOString() }).eq('email', addr);
    return json({ sent: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
