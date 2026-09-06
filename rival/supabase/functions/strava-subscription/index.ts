import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Strava only pushes activity events to apps that hold a live "push
// subscription", and it silently drops that subscription if the callback
// stops returning 2xx. That happened here: webhook-created activities stop
// dead on 2026-08-04, which is why activities went back to only appearing
// when someone opened the app and triggered a sync.
//
// Recreating it needs the app's client secret AND the webhook's verify
// token, neither of which should be pasted into a terminal or read out of
// the Supabase dashboard by hand. This function does it server-side, where
// both already live as secrets, so repairing the subscription is a button
// rather than a credential-handling exercise.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STRAVA_SUBSCRIPTIONS_URL = 'https://www.strava.com/api/v3/push_subscriptions'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    // Admin-only: this can delete the subscription every user's background
    // sync depends on.
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Not authenticated' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const { data: me } = await admin.from('users').select('is_admin').eq('id', user.id).maybeSingle()
    if (!me?.is_admin) return json({ error: 'Admins only' }, 403)

    const clientId = Deno.env.get('STRAVA_CLIENT_ID') ?? ''
    const clientSecret = Deno.env.get('STRAVA_CLIENT_SECRET') ?? ''
    const verifyToken = Deno.env.get('STRAVA_WEBHOOK_VERIFY_TOKEN') ?? ''
    const callbackUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/strava-webhook`
    if (!clientId || !clientSecret || !verifyToken) {
      return json({ error: 'Strava credentials or webhook verify token are not configured' }, 500)
    }

    const { action } = req.method === 'POST' ? await req.json().catch(() => ({ action: 'status' })) : { action: 'status' }

    async function listSubscriptions() {
      const url = `${STRAVA_SUBSCRIPTIONS_URL}?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`
      const res = await fetch(url)
      const body = await res.json().catch(() => null)
      return { ok: res.ok, status: res.status, body }
    }

    if (action === 'status') {
      const result = await listSubscriptions()
      if (!result.ok) return json({ error: 'Strava rejected the credentials', detail: result.body }, 502)
      const subs = Array.isArray(result.body) ? result.body : []
      return json({
        subscribed: subs.length > 0,
        expectedCallback: callbackUrl,
        // A subscription pointing at a stale callback is as dead as no
        // subscription at all, so surface the URL rather than just a count.
        subscriptions: subs.map((s: Record<string, unknown>) => ({ id: s.id, callback_url: s.callback_url, created_at: s.created_at })),
      })
    }

    if (action === 'create') {
      // Strava allows exactly one subscription per application, and returns a
      // confusing "already exists" error rather than replacing it — so clear
      // any stale one (e.g. pointing at an old callback) first.
      const existing = await listSubscriptions()
      if (existing.ok && Array.isArray(existing.body)) {
        for (const sub of existing.body) {
          await fetch(
            `${STRAVA_SUBSCRIPTIONS_URL}/${sub.id}?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`,
            { method: 'DELETE' },
          )
        }
      }

      const form = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        callback_url: callbackUrl,
        verify_token: verifyToken,
      })
      // Strava calls the callback's GET handshake synchronously during this
      // request — if strava-webhook isn't publicly reachable with
      // verify_jwt=false, this is where it fails.
      const res = await fetch(STRAVA_SUBSCRIPTIONS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) return json({ error: 'Strava refused the subscription', detail: body }, 502)
      return json({ created: true, subscription: body, callbackUrl })
    }

    if (action === 'delete') {
      const existing = await listSubscriptions()
      if (!existing.ok) return json({ error: 'Strava rejected the credentials', detail: existing.body }, 502)
      const subs = Array.isArray(existing.body) ? existing.body : []
      for (const sub of subs) {
        await fetch(
          `${STRAVA_SUBSCRIPTIONS_URL}/${sub.id}?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`,
          { method: 'DELETE' },
        )
      }
      return json({ deleted: subs.length })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
