import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { formatDisplayName } from '../_shared/formatName.ts'
import { sendPushMessages } from '../_shared/push.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader ?? '' } } }
    )

    const { data: { user } } = await userClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    const { messageId } = await req.json()
    if (!messageId) {
      return new Response(JSON.stringify({ error: 'messageId is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: message } = await supabase
      .from('league_messages')
      .select('id, league_id, user_id, kind, activity_type, scheduled_at, location, users(display_name, email)')
      .eq('id', messageId)
      .single()

    if (!message || message.user_id !== user.id || message.kind !== 'session') {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      })
    }

    const { data: leagueMembers } = await supabase
      .from('league_members')
      .select('user_id')
      .eq('league_id', message.league_id)
      .neq('user_id', user.id)
      .eq('status', 'active')

    const mateIds = [...new Set((leagueMembers || []).map((m: any) => m.user_id))]
    if (mateIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No league mates' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('user_id, token')
      .in('user_id', mateIds)

    const posterName = formatDisplayName(message.users as any, 'Someone')

    const minutesUntil = message.scheduled_at
      ? Math.round((new Date(message.scheduled_at).getTime() - Date.now()) / 60000)
      : null
    const whenText = minutesUntil == null
      ? 'now'
      : minutesUntil <= 1 ? 'right now' : `in ${minutesUntil} min`

    const locationText = message.location ? ` at ${message.location}` : ''

    const messages = (tokens || []).map((t: any) => ({
      to: t.token,
      title: `${posterName} wants to train 🏃`,
      body: `${message.activity_type || 'Training'} ${whenText}${locationText}. Join?`,
      data: { screen: 'league', leagueId: message.league_id, tab: 'sessions' },
      sound: 'default',
    }))

    if (messages.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No push tokens' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const pushResult = await sendPushMessages(messages)

    return new Response(JSON.stringify(pushResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
