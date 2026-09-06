import { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Image, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { RivalIcon, RivalBackButton, RivalCard, RivalTopNav } from '../components/rival';
import { RivalColors, RivalRadius, RivalType } from '../constants/rivalTheme';
import { formatTeamName } from '../lib/identity';

// What a stranger sees before joining a public team.
//
// The whole point is answering ONE question: is this team alive? A name and a
// logo can't, which is why joining used to be a blind leap. So this leads with
// the week's activity, not with achievement.
//
// Deliberately NOT shown: individual activities, the chat, per-member Effort,
// or a full roster. Members of a team didn't consent to strangers reading
// their week — and a leaderboard here would tell a newcomer where they'd rank
// before they've done anything, which is the wrong first impression and cuts
// against showing up being the thing that counts.
type Preview = {
  id: string;
  name: string;
  logo_url: string | null;
  created_at: string;
  member_count: number;
  sessions_last_7d: number;
  member_names: string[] | null;
};

type Membership = 'none' | 'pending' | 'active';

export default function TeamPreviewScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState<Membership>('none');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [signedIn, setSignedIn] = useState(true);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    if (!id) { setLoading(false); return; }
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    setSignedIn(!!user);

    // Private teams return no row at all — invite-only means invisible, not
    // "visible but locked".
    const { data, error: rpcError } = await supabase.rpc('get_team_preview', { p_league_id: id });
    const row = Array.isArray(data) ? data[0] : data;

    if (rpcError) setError(rpcError.message);
    setPreview(row ?? null);

    if (user && row) {
      const { data: m } = await supabase
        .from('league_members')
        .select('status')
        .eq('league_id', id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (m?.status === 'active') setMembership('active');
      else if (m?.status === 'pending') setMembership('pending');
    }

    setLoading(false);
  }

  async function requestToJoin() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !id) return;
    setJoining(true);
    setError('');
    const { error: insertError } = await supabase
      .from('league_members')
      .insert({ league_id: id, user_id: user.id, role: 'member', status: 'pending' });
    setJoining(false);
    if (insertError) { setError(insertError.message); return; }
    setMembership('pending');
  }

  const memberLabel = (n: number) => `${n} ${n === 1 ? 'member' : 'members'}`;

  function foundedLabel(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' });
  }

  const body = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={RivalColors.accentFill} />
        </View>
      );
    }

    // A signed-out visitor gets a permissions failure, not an empty result —
    // the RPCs are granted to `authenticated` only. Saying "probably private"
    // there would be a guess, and the wrong one.
    if (!preview && !signedIn) {
      return (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Sign in to see this team</Text>
          <Text style={styles.emptyBody}>
            Team previews are for members of RIVAL. It takes a moment to join.
          </Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/sign-in')}>
            <Text style={styles.secondaryBtnText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!preview) {
      return (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>This team isn't open to preview</Text>
          <Text style={styles.emptyBody}>
            It may be private — private teams are joined with an invite code from someone already inside.
          </Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/join-league')}>
            <Text style={styles.secondaryBtnText}>Enter an invite code</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const sessions = Number(preview.sessions_last_7d ?? 0);
    const names = (preview.member_names ?? []).filter(Boolean);

    return (
      <>
        <View style={styles.hero}>
          {preview.logo_url ? (
            <Image source={{ uri: preview.logo_url }} style={styles.logo} />
          ) : (
            <View style={styles.logoFallback}>
              <RivalIcon name="groups" size={34} color={RivalColors.accentText} />
            </View>
          )}
          <Text style={styles.teamName}>{formatTeamName(preview.name)}</Text>
          <Text style={styles.founded}>Together since {foundedLabel(preview.created_at)}</Text>
        </View>

        {/* The aliveness signal, given the most weight on the screen. */}
        <RivalCard glass style={styles.statCard}>
          <Text style={styles.statValue}>{sessions}</Text>
          <Text style={styles.statLabel}>
            {sessions === 1 ? 'session logged this week' : 'sessions logged this week'}
          </Text>
          <Text style={styles.statSub}>
            {sessions > 0
              ? `Across ${memberLabel(preview.member_count)}.`
              : `${memberLabel(preview.member_count)} — no one has logged yet this week.`}
          </Text>
        </RivalCard>

        {names.length > 0 && (
          <RivalCard glass style={styles.peopleCard}>
            <Text style={styles.peopleTitle}>Who's here</Text>
            <Text style={styles.peopleNames}>
              {names.join(', ')}
              {preview.member_count > names.length ? ` and ${preview.member_count - names.length} more` : ''}
            </Text>
          </RivalCard>
        )}

        {!!error && <Text style={styles.error}>{error}</Text>}

        {membership === 'active' ? (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push({ pathname: '/league', params: { id: preview.id } })}
          >
            <Text style={styles.primaryBtnText}>Open team</Text>
          </TouchableOpacity>
        ) : membership === 'pending' ? (
          <View style={styles.pendingPill}>
            <Text style={styles.pendingText}>Request sent — an admin will let you in</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, joining && styles.primaryBtnDisabled]}
            onPress={requestToJoin}
            disabled={joining}
          >
            <Text style={styles.primaryBtnText}>{joining ? 'Sending…' : 'Request to join'}</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.privacyNote}>
          You'll see the team's feed, chat and standings once you're in.
        </Text>
      </>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <RivalTopNav />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <RivalBackButton
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/discover-leagues'))}
            color={RivalColors.accentFill}
          />
          <Text style={styles.headerTitle}>Team</Text>
          <View style={{ width: 48 }} />
        </View>
        {body()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  headerTitle: { ...RivalType.titleMd, color: RivalColors.textPrimary },

  hero: { alignItems: 'center', gap: 8, marginBottom: 24 },
  logo: { width: 84, height: 84, borderRadius: 42, backgroundColor: RivalColors.surfaceContainerHigh },
  logoFallback: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: RivalColors.surfaceContainerHigh,
    alignItems: 'center', justifyContent: 'center',
  },
  teamName: { ...RivalType.headlineLgMobile, color: RivalColors.textPrimary, textAlign: 'center' },
  founded: { fontSize: 13, color: RivalColors.textSecondary },

  statCard: { alignItems: 'center', padding: 24, gap: 4, marginBottom: 12 },
  statValue: { fontSize: 48, fontWeight: '800', color: RivalColors.accentText, lineHeight: 54 },
  statLabel: { fontSize: 15, fontWeight: '600', color: RivalColors.textPrimary },
  statSub: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center', marginTop: 4 },

  peopleCard: { padding: 20, gap: 6, marginBottom: 12 },
  peopleTitle: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary, letterSpacing: 0.6 },
  peopleNames: { fontSize: 15, color: RivalColors.textPrimary, lineHeight: 22 },

  error: { color: RivalColors.error, fontSize: 13, marginBottom: 12 },

  primaryBtn: {
    backgroundColor: RivalColors.accentFill,
    borderRadius: RivalRadius.DEFAULT,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: RivalColors.textPrimary, fontSize: 16, fontWeight: '700' },

  pendingPill: {
    borderRadius: RivalRadius.DEFAULT,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: RivalColors.surfaceContainerHigh,
    marginTop: 8,
  },
  pendingText: { color: RivalColors.textSecondary, fontSize: 14, fontWeight: '600' },

  secondaryBtn: {
    borderRadius: RivalRadius.DEFAULT,
    paddingVertical: 14, paddingHorizontal: 20,
    borderWidth: 1, borderColor: RivalColors.accentFill,
    marginTop: 8,
  },
  secondaryBtnText: { color: RivalColors.accentText, fontSize: 15, fontWeight: '600' },

  emptyTitle: { ...RivalType.titleMd, color: RivalColors.textPrimary, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: RivalColors.textSecondary, textAlign: 'center', lineHeight: 20 },

  privacyNote: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center', marginTop: 16, lineHeight: 17 },
});
