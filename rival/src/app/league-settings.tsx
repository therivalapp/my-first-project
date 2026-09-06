import { useEffect, useState } from 'react';
import { RivalColors, RivalSerifFamily } from '../constants/rivalTheme';
import { RivalIcon, RivalBackButton} from '../components/rival';
import { StyleSheet, TouchableOpacity, View, Text, TextInput, ScrollView, Image, Platform } from 'react-native';
import { confirmAction, notify } from '../lib/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { formatDisplayName, formatTeamName } from '../lib/identity';

// A crest (and the name baked into it) can change once every 6 months —
// often enough to fix a bad first attempt or reflect a real team change,
// rare enough that it still reads as an identity, not a disposable cosmetic.
// Mirrors the same check in supabase/functions/generate-team-crest/index.ts.
function nextCrestEligibleAt(generatedAt: string): Date {
  const d = new Date(generatedAt);
  d.setMonth(d.getMonth() + 6);
  return d;
}
function crestOnCooldown(generatedAt: string | null): boolean {
  if (!generatedAt) return false;
  return Date.now() < nextCrestEligibleAt(generatedAt).getTime();
}

// Mirrors generate-team-crest/index.ts's UNLIMITED_REGEN_USER_ID — keeps the
// button/name-lock UI in sync with the server-side bypass for Ricky's own
// account instead of showing a disabled button the server would actually accept.
const UNLIMITED_REGEN_USER_ID = '09b2e197-8257-4d7c-a0e6-12dc0429eeff';

type Member = {
  user_id: string;
  role: string;
  users: {
    display_name: string | null;
    email: string;
  };
};

export default function LeagueSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [leagueName, setLeagueName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [crestGeneratedAt, setCrestGeneratedAt] = useState<string | null>(null);
  const [generatingCrest, setGeneratingCrest] = useState(false);
  const [crestError, setCrestError] = useState('');
  // 3 candidates come back from one generation call; the admin picks one
  // before it's written to the league (see chooseCrest below).
  const [crestCandidates, setCrestCandidates] = useState<string[] | null>(null);
  const [confirmingCrest, setConfirmingCrest] = useState(false);
  const [isPrivate, setIsPrivate] = useState(true);
  const [pendingRequests, setPendingRequests] = useState<Member[]>([]);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCurrentUserId(user.id);

    // Verify user is admin
    const { data: membership } = await supabase
      .from('league_members')
      .select('role')
      .eq('league_id', id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    if (membership?.role !== 'admin') {
      router.replace('/home');
      return;
    }

    const { data: league } = await supabase
      .from('leagues')
      .select('name, created_by, logo_url, is_private, crest_generated_at')
      .eq('id', id)
      .single();

    if (league) {
      setLeagueName(league.name);
      setNewName(league.name);
      setCreatedBy(league.created_by);
      setLogoUrl(league.logo_url || null);
      setIsPrivate(league.is_private !== false);
      setCrestGeneratedAt(league.crest_generated_at || null);
    }

    const { data: membersData } = await supabase
      .from('league_members')
      .select('user_id, role, users(display_name)')
      .eq('league_id', id)
      .eq('status', 'active');

    if (membersData) setMembers(membersData as any);

    const { data: pendingData } = await supabase
      .from('league_members')
      .select('user_id, role, users(display_name)')
      .eq('league_id', id)
      .eq('status', 'pending');

    if (pendingData) setPendingRequests(pendingData as any);
    setLoading(false);
  }

  async function respondToRequest(userId: string, approve: boolean) {
    setRespondingTo(userId);
    if (approve) {
      const { error } = await supabase.from('league_members').update({ status: 'active' }).eq('league_id', id).eq('user_id', userId);
      if (error) {
        notify("Couldn't approve", error.message);
        setRespondingTo(null);
        return;
      }
      const request = pendingRequests.find((m) => m.user_id === userId);
      if (request) setMembers((prev) => [...prev, request]);
    } else {
      const { error } = await supabase.from('league_members').delete().eq('league_id', id).eq('user_id', userId);
      if (error) {
        notify("Couldn't decline", error.message);
        setRespondingTo(null);
        return;
      }
    }
    setPendingRequests((prev) => prev.filter((m) => m.user_id !== userId));
    setRespondingTo(null);
  }

  async function generateCrest() {
    setGeneratingCrest(true);
    setCrestError('');
    const { data, error } = await supabase.functions.invoke('generate-team-crest', { body: { leagueId: id } });
    if (error || data?.error) {
      setCrestError(data?.error || error?.message || 'Crest generation failed');
      setGeneratingCrest(false);
      return;
    }
    setGeneratingCrest(false);
    setCrestCandidates(data.urls);
  }

  async function chooseCrest(url: string) {
    setConfirmingCrest(true);
    setCrestError('');
    const { error } = await supabase
      .from('leagues')
      .update({ logo_url: url, crest_generated_at: new Date().toISOString() })
      .eq('id', id);
    setConfirmingCrest(false);
    if (error) {
      setCrestError('Failed to save your crest. Please try again.');
      return;
    }
    setLogoUrl(url);
    setCrestGeneratedAt(new Date().toISOString());
    setCrestCandidates(null);
  }

  const cooldownActive = currentUserId !== UNLIMITED_REGEN_USER_ID && crestOnCooldown(crestGeneratedAt);

  async function saveName() {
    if (cooldownActive) {
      setEditingName(false);
      return;
    }
    if (!newName.trim() || newName === leagueName) {
      setEditingName(false);
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('leagues').update({ name: newName.trim() }).eq('id', id);
    if (!error) {
      setLeagueName(newName.trim());
      setEditingName(false);
    } else {
      setNewName(leagueName);
      setEditingName(false);
    }
    setSaving(false);
  }

  async function kickMember(userId: string) {
    const member = members.find((m) => m.user_id === userId);
    const name = member?.users ? formatDisplayName(member.users, 'this member') : 'this member';

    if (!(await confirmAction({ title: `Remove ${name} from the team?`, confirmLabel: 'Remove', destructive: true }))) return;

    const { error } = await supabase
      .from('league_members')
      .delete()
      .eq('league_id', id)
      .eq('user_id', userId);

    if (error) {
      notify("Couldn't remove member", error.message);
      return;
    }
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
  }

  async function toggleAdmin(userId: string, currentRole: string) {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    const { error } = await supabase
      .from('league_members')
      .update({ role: newRole })
      .eq('league_id', id)
      .eq('user_id', userId);

    if (error) {
      notify("Couldn't update role", error.message);
      return;
    }
    setMembers((prev) =>
      prev.map((m) => m.user_id === userId ? { ...m, role: newRole } : m)
    );
  }

  function getDisplayName(member: Member) {
    return formatDisplayName(member.users);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <RivalBackButton onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/team-hub', params: { id } }))} color={RivalColors.accentFill} />
        </View>

        <Text style={styles.title}>Team Settings</Text>

        {/* Crest — AI-generated only, so every team page shares one look
            instead of a mix of AI art and whatever photo someone had on
            hand. logoCard here is just a preview; the only action is
            generateCrest below. */}
        <Text style={styles.sectionLabel}>Team Crest</Text>
        {crestCandidates ? (
          <>
            <Text style={styles.crestPickHint}>Pick your crest:</Text>
            <View style={styles.crestPickRow}>
              {crestCandidates.map((url, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.crestPickFrame}
                  onPress={() => chooseCrest(url)}
                  disabled={confirmingCrest}
                >
                  <Image source={{ uri: url }} style={styles.crestPickImg} />
                </TouchableOpacity>
              ))}
            </View>
            {confirmingCrest ? <Text style={styles.crestPickHint}>Saving your pick…</Text> : null}
          </>
        ) : (
          <>
            <View style={styles.logoCard}>
              {logoUrl ? (
                <Image source={{ uri: logoUrl }} style={styles.logoImage} />
              ) : (
                <View style={styles.logoPlaceholder}>
                  <Text style={styles.logoPlaceholderIcon}>🏟️</Text>
                  <Text style={styles.logoPlaceholderHint}>No crest yet</Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.crestBtn, (generatingCrest || cooldownActive) && styles.crestBtnDisabled]}
              onPress={generateCrest}
              disabled={generatingCrest || cooldownActive}
            >
              <Text style={styles.crestBtnText}>
                {generatingCrest
                  ? 'Generating…'
                  : cooldownActive
                    ? `Next crest available ${nextCrestEligibleAt(crestGeneratedAt!).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                    : crestGeneratedAt ? '✨ Regenerate AI Crest' : '✨ Generate AI Crest'}
              </Text>
            </TouchableOpacity>
          </>
        )}
        {crestError ? <Text style={styles.crestErrorText}>{crestError}</Text> : null}

        {/* Rename */}
        <Text style={styles.sectionLabel}>Team Name</Text>
        <View style={styles.nameCard}>
          {editingName ? (
            <View style={styles.nameEditRow}>
              <TextInput
                style={styles.nameInput}
                value={newName}
                onChangeText={setNewName}
                autoFocus
                autoCapitalize="words"
                maxLength={40}
              />
              <TouchableOpacity style={styles.saveBtn} onPress={saveName} disabled={saving}>
                <Text style={styles.saveBtnText}>{saving ? '…' : 'Save'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setEditingName(false); setNewName(leagueName); }}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : cooldownActive ? (
            <View style={styles.nameRow}>
              <Text style={styles.nameText}>{formatTeamName(leagueName)}</Text>
              <Text style={styles.editHintLocked}>🔒 Locked</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.nameRow} onPress={() => setEditingName(true)}>
              <Text style={styles.nameText}>{formatTeamName(leagueName)}</Text>
              <Text style={styles.editHint}>✏️ Edit</Text>
            </TouchableOpacity>
          )}
        </View>
        {cooldownActive ? (
          <Text style={styles.nameLockedHint}>Your AI crest has this name built into the artwork, so the name is locked until your next crest is available.</Text>
        ) : null}

        {/* Visibility */}
        <Text style={styles.sectionLabel}>Visibility</Text>
        <View style={styles.visibilityCard}>
          <View style={styles.visibilityRow}>
            <View>
              <Text style={styles.visibilityTitle}>{isPrivate ? '🔒 Private' : '🌍 Public'}</Text>
              <Text style={styles.visibilityDesc}>
                {isPrivate
                  ? 'Only people with the invite code can join.'
                  : 'Anyone can discover and join this team.'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.visibilityToggle, !isPrivate && styles.visibilityToggleOn]}
              onPress={async () => {
                const newVal = !isPrivate;
                setIsPrivate(newVal);
                const { error } = await supabase.from('leagues').update({ is_private: newVal }).eq('id', id);
                if (error) {
                  // Put the switch back. Showing "Private" over a team that is
                  // still discoverable is a privacy failure, not a cosmetic one.
                  setIsPrivate(!newVal);
                  notify("Couldn't change who can find this team", error.message);
                }
              }}
            >
              <Text style={styles.visibilityToggleText}>{isPrivate ? 'Make Public' : 'Make Private'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Join Requests */}
        {pendingRequests.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Join Requests</Text>
            <View style={[styles.membersCard, { marginBottom: 28 }]}>
              {pendingRequests.map((request) => (
                <View key={request.user_id} style={styles.memberRow}>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{formatDisplayName(request.users)}</Text>
                  </View>
                  <View style={styles.memberActions}>
                    <TouchableOpacity
                      style={styles.adminToggleBtn}
                      onPress={() => respondToRequest(request.user_id, true)}
                      disabled={respondingTo === request.user_id}
                    >
                      <Text style={styles.adminToggleText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.kickBtn}
                      onPress={() => respondToRequest(request.user_id, false)}
                      disabled={respondingTo === request.user_id}
                    >
                      <Text style={styles.kickText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Members */}
        <Text style={styles.sectionLabel}>Members</Text>
        <View style={styles.membersCard}>
          {members.map((member) => (
            <View key={member.user_id} style={styles.memberRow}>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>
                  {getDisplayName(member)}
                  {member.user_id === currentUserId ? ' (you)' : ''}
                </Text>
                {member.role === 'admin' && (
                  <Text style={styles.adminBadge}>Admin</Text>
                )}
              </View>
              {member.user_id !== currentUserId && member.user_id !== createdBy && (
                <View style={styles.memberActions}>
                  <TouchableOpacity
                    style={styles.adminToggleBtn}
                    onPress={() => toggleAdmin(member.user_id, member.role)}
                  >
                    <Text style={styles.adminToggleText}>
                      {member.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.kickBtn}
                    onPress={() => kickMember(member.user_id)}
                  >
                    <Text style={styles.kickText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: RivalColors.surfaceLow,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: RivalColors.textSecondary,
    fontSize: 16,
  },
  header: {
    marginBottom: 24,
  },
  back: {
    color: RivalColors.accentFill,
    fontSize: 16,
  },
  title: {
    fontFamily: RivalSerifFamily,
    fontStyle: 'italic',
    fontSize: 26,
    fontWeight: '700',
    color: RivalColors.textPrimary,
    marginBottom: 28,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: RivalColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  visibilityCard: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  visibilityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  visibilityTitle: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary, marginBottom: 4 },
  visibilityDesc: { fontSize: 12, color: RivalColors.textSecondary, flexShrink: 1 },
  visibilityToggle: { backgroundColor: '#0D0D0D', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  visibilityToggleOn: { backgroundColor: '#0A1A0F', borderColor: RivalColors.accentText },
  visibilityToggleText: { fontSize: 12, fontWeight: '700', color: '#CCCCCC' },
  nameCard: {
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: RivalColors.accentText,
    marginBottom: 28,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nameText: {
    fontSize: 18,
    fontWeight: '700',
    color: RivalColors.textPrimary,
  },
  editHint: {
    fontSize: 13,
    color: RivalColors.accentFill,
  },
  editHintLocked: {
    fontSize: 13,
    color: RivalColors.textSecondary,
  },
  nameLockedHint: {
    fontSize: 12,
    color: RivalColors.textSecondary,
    marginTop: -20,
    marginBottom: 20,
  },
  nameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  nameInput: {
    flex: 1,
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: RivalColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: RivalColors.accentFill,
  },
  saveBtn: {
    backgroundColor: RivalColors.accentFill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveBtnText: {
    color: RivalColors.textPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  cancelText: {
    color: RivalColors.textSecondary,
    fontSize: 13,
  },
  logoCard: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, borderWidth: 1, borderColor: RivalColors.accentText, marginBottom: 28, overflow: 'hidden', alignItems: 'center' },
  logoImage: { width: '100%', height: 160 },
  logoPlaceholder: { paddingVertical: 32, alignItems: 'center', gap: 8 },
  logoPlaceholderIcon: { fontSize: 36 },
  logoPlaceholderHint: { fontSize: 13, color: RivalColors.textSecondary },
  crestBtn: { marginTop: 10, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: RivalColors.accentFill },
  crestBtnDisabled: { backgroundColor: RivalColors.surfaceHigh },
  crestBtnText: { color: RivalColors.textPrimary, fontSize: 14, fontWeight: '700' },
  crestErrorText: { color: '#FF6B6B', fontSize: 13, marginTop: 6 },
  crestPickHint: { color: RivalColors.textSecondary, fontSize: 13, marginBottom: 10 },
  crestPickRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  crestPickFrame: { flex: 1, aspectRatio: 1, backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, borderWidth: 1, borderColor: RivalColors.accentText, overflow: 'hidden' },
  crestPickImg: { width: '100%', height: '100%' },
  membersCard: {
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: RivalColors.accentText,
    overflow: 'hidden',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#3d1a6e',
  },
  memberInfo: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    color: RivalColors.textPrimary,
  },
  adminBadge: {
    fontSize: 11,
    color: RivalColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  memberActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  adminToggleBtn: {
    borderWidth: 1,
    borderColor: RivalColors.accentFill,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  adminToggleText: {
    color: RivalColors.accentFill,
    fontSize: 12,
    fontWeight: '600',
  },
  kickBtn: {
    borderWidth: 1,
    borderColor: '#dc2626',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  kickText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
  },
});
