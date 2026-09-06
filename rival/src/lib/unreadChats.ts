import { supabase } from './supabase';

// How many of your teams have chat you haven't read.
//
// Shared rather than copied because it now drives TWO things that must agree:
// the Chat tab's badge and the unread dots in messages.tsx. A badge that says
// 2 over a list showing 3 dots is worse than no badge at all.
//
// Counts TEAMS, not messages: the badge sits on a tab that opens a list of
// teams, so the number should match the number of rows you're about to see
// marked unread.

export type UnreadResult = {
  /** Teams with unread chat. */
  count: number;
  /** Per-team, for the messages list. */
  byLeague: Record<string, boolean>;
};

const EMPTY: UnreadResult = { count: 0, byLeague: {} };

// The nav bar re-checks on every route change, and this costs two queries, so
// without a floor a burst of navigation would fire them repeatedly for a
// number that can't have moved. 15s is short enough that a message arriving
// while you're on another screen still shows up almost immediately.
const CACHE_MS = 15_000;
let cache: { at: number; result: UnreadResult } | null = null;

/** Call after reading a thread, so the badge doesn't stay lit for 15s. */
export function invalidateUnreadChats() {
  cache = null;
}

export async function getUnreadChats(force = false): Promise<UnreadResult> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.result;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return EMPTY;

  const { data: memberships } = await supabase
    .from('league_members')
    .select('league_id')
    .eq('user_id', user.id)
    .eq('status', 'active');

  const leagueIds = (memberships ?? []).map((m: any) => m.league_id);
  if (leagueIds.length === 0) return EMPTY;

  const [{ data: messages }, { data: reads }] = await Promise.all([
    // Newest-first across every team at once, then keep the first row per
    // league below — one round trip instead of one per team.
    supabase
      .from('league_messages')
      .select('league_id, user_id, created_at')
      .in('league_id', leagueIds)
      .eq('kind', 'text')
      .order('created_at', { ascending: false }),
    supabase
      .from('league_chat_reads')
      .select('league_id, last_read_at')
      .eq('user_id', user.id)
      .in('league_id', leagueIds),
  ]);

  const lastByLeague = new Map<string, { user_id: string; created_at: string }>();
  for (const m of messages ?? []) {
    if (!lastByLeague.has(m.league_id)) lastByLeague.set(m.league_id, m);
  }
  const readByLeague = new Map((reads ?? []).map((r: any) => [r.league_id, r.last_read_at]));

  const byLeague: Record<string, boolean> = {};
  let count = 0;
  for (const leagueId of leagueIds) {
    const last = lastByLeague.get(leagueId);
    const lastReadAt = readByLeague.get(leagueId);
    // Your own message must never mark a thread unread. Without this the badge
    // lights up the moment YOU post — telling you that you have something to
    // read, about something you just wrote.
    const unread = !!last
      && last.user_id !== user.id
      && (!lastReadAt || new Date(last.created_at) > new Date(lastReadAt));
    byLeague[leagueId] = unread;
    if (unread) count += 1;
  }

  const result = { count, byLeague };
  cache = { at: Date.now(), result };
  return result;
}
