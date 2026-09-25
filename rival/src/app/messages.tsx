import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, Image, TouchableOpacity, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { formatTeamName } from '../lib/identity';
import { RivalTopNav, RivalIcon, RivalWarm, rm } from '../components/rival';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { getUnreadChats } from '../lib/unreadChats';
import { RivalColors, RivalSerifFamily, RivalButtonColors } from '../constants/rivalTheme';

// Same per-name color assignment as team-feed.tsx's team rail — kept as a
// local copy rather than shared, matching how timeAgo is already duplicated
// per-screen across this codebase instead of centralized.
const TINTS = [
  { bg: '#8a6a5a33', color: '#c99a86' },
  { bg: '#5a7a8a33', color: '#8fb0c2' },
  { bg: '#8a5a7a33', color: '#c286b0' },
  { bg: '#7a8a5a33', color: '#a8bd83' },
  { bg: '#5a8a7a33', color: '#7fc2ab' },
];
function tintFor(name: string): { bg: string; color: string } {
  let hash = 0;
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return TINTS[Math.abs(hash) % TINTS.length];
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

type ThreadRow = {
  leagueId: string;
  name: string;
  logoUrl: string | null;
  lastBody: string | null;
  lastAt: string | null;
  lastIsMine: boolean;
  unread: boolean;
};

export default function MessagesScreen() {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: { user } } = await getAuthUser();
    if (!user) { setLoading(false); return; }

    const { data: memberships } = await supabase
      .from('league_members')
      .select('league_id')
      .eq('user_id', user.id)
      .eq('status', 'active');
    const leagueIds = (memberships ?? []).map((m) => m.league_id);
    if (leagueIds.length === 0) {
      setThreads([]);
      setLoading(false);
      return;
    }

    const [{ data: leagues }, { data: messages }, unread] = await Promise.all([
      supabase.from('leagues').select('id, name, logo_url').in('id', leagueIds),
      // Newest-first across every team at once, then keep just the first (most
      // recent) row per league_id below — one round trip instead of N.
      supabase.from('league_messages').select('league_id, user_id, body, created_at').in('league_id', leagueIds).eq('kind', 'text').order('created_at', { ascending: false }),
      // Shared with the Chat tab's badge — a badge reading "2" over a list
      // showing three dots is worse than showing no badge at all.
      getUnreadChats(true),
    ]);

    const lastByLeague = new Map<string, { user_id: string; body: string; created_at: string }>();
    for (const m of messages ?? []) {
      if (!lastByLeague.has(m.league_id)) lastByLeague.set(m.league_id, m);
    }

    const rows: ThreadRow[] = (leagues ?? [])
      .map((l) => {
        const last = lastByLeague.get(l.id);
        const isUnread = unread.byLeague[l.id] ?? false;
        return {
          leagueId: l.id,
          name: l.name,
          logoUrl: l.logo_url,
          lastBody: last?.body ?? null,
          lastAt: last?.created_at ?? null,
          lastIsMine: last?.user_id === user.id,
          unread: isUnread,
        };
      })
      .sort((a, b) => {
        if (!a.lastAt && !b.lastAt) return a.name.localeCompare(b.name);
        if (!a.lastAt) return 1;
        if (!b.lastAt) return -1;
        return b.lastAt.localeCompare(a.lastAt);
      });

    setThreads(rows);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  // Phone: the RIVAL look — warm page, team names in the serif.
  const { width } = useWindowDimensions();
  const mob = width < BREAKPOINT_WIDE_LAYOUT;

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.mBgFixed, mob && ms.bg]} />
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <RivalTopNav active="chat" />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.title, mob && ms.title]}>Messages</Text>

          {loading ? (
            <Text style={styles.stateText}>Loading…</Text>
          ) : threads.length === 0 ? (
            <View style={[styles.emptyState, mob && [rm.card, ms.empty]]}>
              {mob ? (
                <View style={rm.iconCircle}><RivalIcon name="chat" size={20} color={RivalColors.accentText} /></View>
              ) : (
                <RivalIcon name="chat" size={28} color={RivalColors.accentText} />
              )}
              <Text style={[styles.emptyTitle, mob && ms.emptyTitle]}>No team chats yet</Text>
              <Text style={styles.emptyBody}>Join or create a team to message teammates.</Text>
              <TouchableOpacity style={mob ? [rm.primary, ms.emptyBtn] : styles.emptyBtn} onPress={() => router.push('/discover-leagues')}>
                <Text style={mob ? rm.primaryText : styles.emptyBtnText}>Find a team</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.list}>
              {threads.map((t) => {
                const tint = tintFor(t.name);
                return (
                  <TouchableOpacity
                    key={t.leagueId}
                    style={[styles.row, mob && ms.row]}
                    onPress={() => router.push({ pathname: '/chat', params: { id: t.leagueId } })}
                  >
                    {t.logoUrl ? (
                      <Image source={{ uri: t.logoUrl }} style={[styles.avatar, mob && ms.crest]} />
                    ) : (
                      <View style={[styles.avatarFallback, { backgroundColor: tint.bg }]}>
                        <Text style={[styles.avatarInitial, { color: tint.color }]}>{t.name[0]?.toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={styles.rowMain}>
                      <View style={styles.rowTop}>
                        <Text style={[styles.rowName, mob && ms.rowName, t.unread && styles.rowNameUnread]} numberOfLines={1}>
                          {formatTeamName(t.name)}
                        </Text>
                        {t.lastAt && <Text style={styles.rowTime}>{timeAgo(t.lastAt)}</Text>}
                      </View>
                      <Text style={[styles.rowPreview, t.unread && styles.rowPreviewUnread]} numberOfLines={1}>
                        {t.lastBody ? `${t.lastIsMine ? 'You: ' : ''}${t.lastBody}` : 'No messages yet.'}
                      </Text>
                    </View>
                    {t.unread && <View style={styles.unreadDot} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  mBgFixed: {
    position: 'fixed' as any, top: 0, left: 0, right: 0, width: '100%',
    height: '100vh' as any,
    backgroundColor: '#131313',
    ...(Platform.OS === 'web' ? { backgroundImage: 'radial-gradient(ellipse 140% 90% at 88% 105%, rgba(217,119,87,0.10) 0%, rgba(19,19,19,0) 55%)' } as any : {}),
  },
  container: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 48, gap: 16, width: '100%', maxWidth: 640, marginHorizontal: 'auto' },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 22, fontWeight: '700', color: '#fff' },
  stateText: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', marginTop: 40 },

  list: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  avatar: { width: 48, height: 48, borderRadius: 14 },
  avatarFallback: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 17, fontWeight: '800' },
  rowMain: { flex: 1, gap: 2, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowName: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.85)', flexShrink: 1 },
  rowNameUnread: { color: '#fff' },
  rowTime: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  rowPreview: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  rowPreviewUnread: { color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: RivalColors.accentFill },

  emptyState: { alignItems: 'center', gap: 8, paddingVertical: 48, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  emptyBody: { fontSize: 13, color: 'rgba(255,255,255,0.55)', textAlign: 'center' },
  emptyBtn: { marginTop: 8, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24 },
  emptyBtnText: { fontSize: 13, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
});

// Phone only — the RIVAL look (see RivalMobile.tsx).
const ms = StyleSheet.create({
  bg: { backgroundColor: RivalWarm.page },
  title: { fontSize: 26, lineHeight: 32 },
  row: { borderBottomColor: RivalWarm.hairline },
  crest: { borderWidth: 1, borderColor: RivalWarm.cardBorder },
  rowName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 17 },
  empty: { alignItems: 'center', paddingVertical: 28 },
  emptyTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 20 },
  emptyBtn: { alignSelf: 'stretch', marginTop: 8 },
});
