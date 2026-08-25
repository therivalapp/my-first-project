import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, TextInput, ScrollView, Image, Platform, useWindowDimensions, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notify';
import { isValidUsername } from '../lib/identity';
import { getQuote, QuoteTone } from '../lib/quotes';
import { RivalButton, RivalCard, RivalIcon, RivalIconName, RivalTopNav } from '../components/rival';
import { RivalColors, RivalRadius, RivalType } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';

const DISPLAY_STYLES: Array<{ value: string; label: string; sample: (name: string, username: string | null) => string }> = [
  { value: 'real_name_username', label: 'Real name + Username', sample: (name, u) => u ? `${name}  ·  @${u}` : name },
  { value: 'username_only', label: 'Username only', sample: (_name, u) => u ? `@${u}` : 'Set a username first' },
  { value: 'first_last_initial', label: 'First name + Last initial', sample: (name) => {
      const parts = name.trim().split(/\s+/);
      return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || name;
    } },
];

const QUOTE_TONES: Array<{ value: QuoteTone; label: string; sub: string }> = [
  { value: 'blunt', label: 'Blunt', sub: 'Hard truths, no cushioning.' },
  { value: 'balanced', label: 'Balanced', sub: 'A mix of tough and supportive.' },
  { value: 'encouraging', label: 'Encouraging', sub: 'Warm, patient, always in your corner.' },
];

type TabId = 'personal' | 'apps' | 'notifications' | 'account';
const TABS: Array<{ id: TabId; label: string; icon: RivalIconName }> = [
  { id: 'personal', label: 'Personal Info', icon: 'person' },
  { id: 'apps', label: 'Connected Apps', icon: 'link' },
  { id: 'notifications', label: 'Notifications', icon: 'notifications' },
  { id: 'account', label: 'Account', icon: 'settings' },
];

export default function ProfileScreen() {
  const { userId: viewedUserId, tab: tabParam } = useLocalSearchParams<{ userId?: string; tab?: TabId }>();
  const { width: windowWidth } = useWindowDimensions();
  const wide = windowWidth >= BREAKPOINT_WIDE_LAYOUT;

  const [currentAuthUserId, setCurrentAuthUserId] = useState('');
  const isOwnProfile = !viewedUserId || viewedUserId === currentAuthUserId;

  // Viewing someone else's profile is a stats view, not a settings view —
  // bounce to their stats page. Settings only ever apply to your own account.
  useEffect(() => {
    if (viewedUserId) router.replace({ pathname: '/stats', params: { userId: viewedUserId } });
  }, [viewedUserId]);

  const [activeTab, setActiveTab] = useState<TabId>(
    tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'personal'
  );

  const [displayName, setDisplayName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [username, setUsername] = useState<string | null>(null);
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [bio, setBio] = useState('');
  const [newBio, setNewBio] = useState('');
  const [savingBio, setSavingBio] = useState(false);
  const [displayStyle, setDisplayStyle] = useState('real_name_username');
  const [savingStyle, setSavingStyle] = useState(false);
  const [quoteTone, setQuoteTone] = useState<QuoteTone>('balanced');
  const [savingTone, setSavingTone] = useState(false);
  const [quotePreview, setQuotePreview] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [memberSince, setMemberSince] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [stravaAthleteName, setStravaAthleteName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [importingHistory, setImportingHistory] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  async function handlePullToRefresh() {
    setRefreshing(true);
    await loadProfile();
    setRefreshing(false);
  }

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setCurrentAuthUserId(user.id);

    setEmail(user.email ?? '');
    if (user.created_at) {
      const d = new Date(user.created_at);
      setMemberSince(d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
    }

    const [userRes, stravaRes] = await Promise.all([
      supabase.from('users').select('display_name, is_admin, avatar_url, username, bio, display_style, quote_tone').eq('id', user.id).single(),
      supabase.from('fitness_connections').select('athlete_firstname, athlete_lastname').eq('user_id', user.id).eq('provider', 'strava').maybeSingle(),
    ]);

    const name = userRes.data?.display_name || user.user_metadata?.display_name || '';
    setDisplayName(name);
    setNewName(name);
    setIsAdmin(!!userRes.data?.is_admin);
    setAvatarUrl(userRes.data?.avatar_url || null);
    setUsername(userRes.data?.username || null);
    setNewUsername(userRes.data?.username || '');
    setBio(userRes.data?.bio || '');
    setNewBio(userRes.data?.bio || '');
    setDisplayStyle(userRes.data?.display_style || 'real_name_username');
    setQuoteTone((userRes.data?.quote_tone as QuoteTone) || 'balanced');
    setStravaConnected(!!stravaRes.data);
    setStravaAthleteName(
      stravaRes.data ? [stravaRes.data.athlete_firstname, stravaRes.data.athlete_lastname].filter(Boolean).join(' ') || null : null
    );

    setLoading(false);
  }

  async function saveName() {
    if (!newName.trim()) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const { error } = await supabase.from('users').update({ display_name: newName.trim() }).eq('id', user.id);
    if (error) {
      // Don't advance the UI past a write that didn't land — showing the new
      // name while the row still holds the old one is worse than an error.
      notify("Couldn't save your name", error.message);
      setSaving(false);
      return;
    }
    await supabase.auth.updateUser({ data: { display_name: newName.trim() } });
    setDisplayName(newName.trim());
    setEditingName(false);
    setSaving(false);
  }

  async function saveUsername() {
    const trimmed = newUsername.trim().toLowerCase();
    if (trimmed && !isValidUsername(trimmed)) {
      setUsernameError('3-20 characters, lowercase letters, numbers, underscores only.');
      return;
    }
    setSavingUsername(true);
    setUsernameError('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingUsername(false); return; }
    const { error } = await supabase.from('users').update({ username: trimmed || null }).eq('id', user.id);
    if (error) {
      setUsernameError(error.code === '23505' ? 'That username is already taken.' : 'Could not save username.');
      setSavingUsername(false);
      return;
    }
    setUsername(trimmed || null);
    setEditingUsername(false);
    setSavingUsername(false);
  }

  async function saveBio() {
    const trimmed = newBio.trim();
    setSavingBio(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingBio(false); return; }
    const { error } = await supabase.from('users').update({ bio: trimmed || null }).eq('id', user.id);
    if (error) { notify("Couldn't save bio", error.message); setSavingBio(false); return; }
    setBio(trimmed);
    setNewBio(trimmed);
    setSavingBio(false);
  }

  async function updateDisplayStyle(style: string) {
    if (style === displayStyle) return;
    setSavingStyle(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingStyle(false); return; }
    const { error } = await supabase.from('users').update({ display_style: style }).eq('id', user.id);
    if (error) {
      notify("Couldn't save that name style", error.message);
      setSavingStyle(false);
      return;
    }
    setDisplayStyle(style);
    setSavingStyle(false);
  }

  async function updateQuoteTone(tone: QuoteTone) {
    setSavingTone(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingTone(false); return; }
    const { error } = await supabase.from('users').update({ quote_tone: tone }).eq('id', user.id);
    if (error) {
      notify("Couldn't save that preference", error.message);
      setSavingTone(false);
      return;
    }
    setQuoteTone(tone);
    setQuotePreview(getQuote(tone).text);
    setSavingTone(false);
  }

  async function uploadAvatar() {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploadingAvatar(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const ext = file.name.split('.').pop() || 'jpg';
        const path = `${user.id}/avatar.${ext}`;
        const { error: storageErr } = await supabase.storage
          .from('avatars')
          .upload(path, file, { contentType: file.type, upsert: true });
        if (!storageErr) {
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
          // The file uploaded, but the row still has to point at it — if this
          // half fails the photo is orphaned in storage and the profile keeps
          // the old avatar, so say so rather than showing the new one.
          const { error: rowErr } = await supabase.from('users').update({ avatar_url: urlData.publicUrl }).eq('id', user.id);
          if (rowErr) {
            notify("Couldn't update your photo", rowErr.message);
          } else {
            setAvatarUrl(urlData.publicUrl);
          }
        }
      } finally {
        setUploadingAvatar(false);
      }
    };
    input.click();
  }

  async function disconnectStrava(wipeActivities: boolean) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setDisconnecting(true);
    // The connection row is the thing that actually keeps Strava linked. If this
    // fails silently the UI shows "disconnected" while the sync keeps running.
    const { error: connErr } = await supabase.from('fitness_connections').delete().eq('user_id', user.id).eq('provider', 'strava');
    if (connErr) {
      notify("Couldn't disconnect Strava", connErr.message);
      setDisconnecting(false);
      return;
    }

    if (wipeActivities) {
      const { error: wipeErr } = await supabase.from('activities').delete().eq('user_id', user.id).eq('provider', 'strava');
      // RLS failures are silent (0 rows, no error) — verify the wipe actually happened.
      const { count: leftBehind } = await supabase
        .from('activities')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('provider', 'strava');
      if (wipeErr || (leftBehind ?? 0) > 0) {
        notify(
          "Couldn't remove imported activities",
          wipeErr?.message || `${leftBehind} imported activities could not be deleted. Strava is disconnected, but the data is still there — please try again.`
        );
        setDisconnecting(false);
        setConfirmingDisconnect(false);
        setStravaConnected(false);
        loadProfile();
        return;
      }

      // Milestones are earned off total hours across all activities — if the
      // Strava data being wiped was never legitimately yours (e.g. it landed
      // here from an accidental cross-account connection), any badge it
      // unlocked shouldn't survive the wipe either.
      const HOUR_THRESHOLDS: Record<string, number> = { hours_100: 100, hours_500: 500, hours_1000: 1000, hours_5000: 5000 };
      const [{ data: remaining }, { data: myMilestones }] = await Promise.all([
        supabase.from('activities').select('duration_seconds').eq('user_id', user.id),
        supabase.from('milestones').select('id, type').eq('user_id', user.id),
      ]);
      const remainingHours = (remaining || []).reduce((s, a) => s + (a.duration_seconds || 0), 0) / 3600;
      const toRemove = (myMilestones || [])
        .filter(m => (HOUR_THRESHOLDS[m.type] ?? 0) > remainingHours)
        .map(m => m.id);
      if (toRemove.length > 0) {
        const { error: milestoneErr } = await supabase.from('milestones').delete().in('id', toRemove);
        if (milestoneErr) notify("Couldn't update milestones", milestoneErr.message);
      }
    }

    setStravaConnected(false);
    setConfirmingDisconnect(false);
    setDisconnecting(false);
    loadProfile();
  }

  async function syncNow() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setSyncing(true);
    try {
      const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/strava-backfill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        notify('Sync failed', data.error || 'Could not sync with Strava. Try reconnecting Strava.');
      } else if (data.saved === 0) {
        notify('Nothing new', 'No new Strava activities found.');
      } else {
        notify('Synced', `Pulled in ${data.saved} new activities.`);
      }
    } catch {
      notify('Sync failed', 'Could not reach the server. Check your connection and try again.');
    } finally {
      setSyncing(false);
      // Fire-and-forget milestone check after every sync
      supabase.auth.getSession().then(({ data: { session: s } }) => {
        if (!s) return;
        fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/check-milestones`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s.access_token}`, 'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! },
        }).catch(() => {});
      });
    }
  }

  async function importFullHistory() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setImportingHistory(true);
    try {
      const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/strava-full-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        notify('Import failed', data.error || 'Could not import your Strava history.');
        return;
      }
      if (data.partial) {
        notify('Import paused', `Pulled in ${data.saved} activities before it was interrupted. ${data.partialReason || 'Run the import again shortly to get the rest.'}`);
      } else {
        notify('Import complete', `Pulled in ${data.saved} activities from your full Strava history.`);
      }
      loadProfile();
    } catch {
      notify('Import failed', 'Could not reach the server. Try again.');
    } finally {
      setImportingHistory(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/');
  }

  async function handleDeleteAccount() {
    // Typed confirmation ("DELETE") — a tap-through dialog is too easy to
    // fat-finger for something this permanent. window.prompt because
    // Alert.alert button callbacks don't fire on web.
    const typed = Platform.OS === 'web'
      ? window.prompt(
          'This permanently deletes your account: all activities, teams you\'re in, ' +
          'photos, races, goals, and history. Teams you created will be handed to ' +
          'another member (or deleted if empty). This cannot be undone.\n\n' +
          'Type DELETE to confirm.'
        )
      : null; // native flow needs a custom modal — web-only until the iOS build exists
    if (typed !== 'DELETE') return;

    setDeletingAccount(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      const data = await res.json();
      if (!res.ok || !data.deleted) {
        notify("Couldn't delete account", data.error || 'Please try again or contact support.');
        return;
      }
      await supabase.auth.signOut();
      router.replace('/');
    } catch {
      notify("Couldn't delete account", 'Could not reach the server. Try again.');
    } finally {
      setDeletingAccount(false);
    }
  }

  if (loading || !isOwnProfile) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const bioDirty = newBio.trim() !== bio;

  // ---- Tab panels ----------------------------------------------------------

  const personalPanel = (
    <RivalCard glass style={styles.panel}>
      <View style={[styles.personalTop, wide && styles.personalTopWide]}>
        <TouchableOpacity onPress={uploadAvatar} disabled={uploadingAvatar} style={styles.avatarWrap}>
          <View style={styles.avatar}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{displayName ? displayName[0].toUpperCase() : '?'}</Text>
            )}
          </View>
          <View style={styles.avatarEditBadge}>
            {uploadingAvatar
              ? <Text style={styles.avatarEditText}>⏳</Text>
              : <RivalIcon name="edit" size={12} color={RivalColors.textPrimary} />}
          </View>
        </TouchableOpacity>

        <View style={styles.fieldsCol}>
          {/* Full Name */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>FULL NAME</Text>
            {editingName ? (
              <View style={styles.editRow}>
                <TextInput style={styles.input} value={newName} onChangeText={setNewName} autoFocus autoCapitalize="words" />
                <TouchableOpacity style={styles.saveChip} onPress={saveName} disabled={saving}>
                  <Text style={styles.saveChipText}>{saving ? '…' : 'Save'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setEditingName(false); setNewName(displayName); }}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.readField} onPress={() => setEditingName(true)}>
                <Text style={styles.readFieldValue}>{displayName || 'Set your name'}</Text>
                <RivalIcon name="edit" size={14} color={RivalColors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Username */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>USERNAME</Text>
            {editingUsername ? (
              <View style={styles.editRow}>
                <Text style={styles.usernameAt}>@</Text>
                <TextInput
                  style={styles.input}
                  value={newUsername}
                  onChangeText={(t) => { setNewUsername(t.toLowerCase().replace(/[^a-z0-9_]/g, '')); setUsernameError(''); }}
                  autoFocus autoCapitalize="none" placeholder="username" placeholderTextColor={RivalColors.textSecondary}
                />
                <TouchableOpacity style={styles.saveChip} onPress={saveUsername} disabled={savingUsername}>
                  <Text style={styles.saveChipText}>{savingUsername ? '…' : 'Save'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setEditingUsername(false); setNewUsername(username || ''); setUsernameError(''); }}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.readField} onPress={() => setEditingUsername(true)}>
                <Text style={styles.readFieldValue}>{username ? `@${username}` : 'Set a username'}</Text>
                <RivalIcon name="edit" size={14} color={RivalColors.textSecondary} />
              </TouchableOpacity>
            )}
            {!!usernameError && <Text style={styles.errorText}>{usernameError}</Text>}
          </View>

          {/* Email (read-only) */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>EMAIL ADDRESS</Text>
            <View style={[styles.readField, styles.readFieldDisabled]}>
              <Text style={styles.readFieldValue}>{email || '—'}</Text>
            </View>
          </View>

          {/* Bio */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>BIO</Text>
            <TextInput
              style={styles.bioInput}
              value={newBio}
              onChangeText={(t) => setNewBio(t.slice(0, 280))}
              placeholder="Who are you, and why do you train?"
              placeholderTextColor={RivalColors.textSecondary}
              multiline
              numberOfLines={3}
            />
            <View style={styles.bioFooter}>
              <Text style={styles.bioHint}>Focus on your philosophy, not just your personal bests.</Text>
              <Text style={styles.bioCount}>{newBio.length}/280</Text>
            </View>
            {bioDirty && (
              <View style={styles.bioSaveRow}>
                <TouchableOpacity onPress={() => setNewBio(bio)}><Text style={styles.cancelText}>Discard</Text></TouchableOpacity>
                <TouchableOpacity style={styles.saveChip} onPress={saveBio} disabled={savingBio}>
                  <Text style={styles.saveChipText}>{savingBio ? '…' : 'Save bio'}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Name display style */}
      <View style={styles.subSection}>
        <Text style={styles.subSectionTitle}>HOW OTHERS SEE YOUR NAME</Text>
        {DISPLAY_STYLES.map((opt) => {
          const selected = displayStyle === opt.value;
          const disabled = opt.value === 'username_only' && !username;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.optionRow, selected && styles.optionRowActive]}
              onPress={() => !disabled && updateDisplayStyle(opt.value)}
              disabled={savingStyle || disabled}
            >
              <View style={styles.optionTextWrap}>
                <Text style={[styles.optionLabel, selected && { color: RivalColors.accentText }]}>{opt.label}</Text>
                <Text style={styles.optionSample}>{opt.sample(displayName || 'Athlete', username)}</Text>
              </View>
              <Text style={[styles.optionCheck, selected && { color: RivalColors.accentText }]}>{selected ? '●' : '○'}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Daily quote tone */}
      <View style={styles.subSection}>
        <Text style={styles.subSectionTitle}>DAILY MOTIVATION TONE</Text>
        {QUOTE_TONES.map((opt) => {
          const selected = quoteTone === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.optionRow, selected && styles.optionRowActive]}
              onPress={() => updateQuoteTone(opt.value)}
              disabled={savingTone}
            >
              <View style={styles.optionTextWrap}>
                <Text style={[styles.optionLabel, selected && { color: RivalColors.accentText }]}>{opt.label}</Text>
                <Text style={styles.optionSample}>{opt.sub}</Text>
              </View>
              <Text style={[styles.optionCheck, selected && { color: RivalColors.accentText }]}>{selected ? '●' : '○'}</Text>
            </TouchableOpacity>
          );
        })}
        {quotePreview && <Text style={styles.quotePreview}>"{quotePreview}"</Text>}
      </View>

      {/* Link to stats */}
      <TouchableOpacity style={styles.statsLink} onPress={() => router.push('/stats')}>
        <RivalIcon name="stats" size={16} color={RivalColors.textPrimary} />
        <Text style={styles.statsLinkText}>See your stats — rank, milestones, Impact & more</Text>
        <Text style={styles.statsLinkArrow}>→</Text>
      </TouchableOpacity>

      {/* Moved here from the Activity Journal screen — a settings-style link
          out, same as the stats link above, fits better here than sitting
          inline in the activity feed. */}
      <TouchableOpacity style={styles.statsLink} onPress={() => router.push('/lifts')}>
        <RivalIcon name="target" size={16} color={RivalColors.textPrimary} />
        <Text style={styles.statsLinkText}>View Personal Bests</Text>
        <Text style={styles.statsLinkArrow}>→</Text>
      </TouchableOpacity>
    </RivalCard>
  );

  const appsPanel = (
    <RivalCard glass style={styles.panel}>
      <Text style={styles.panelTitle}>Connected Apps</Text>
      <Text style={styles.panelSub}>Sync your training automatically from the services you already use.</Text>

      <View style={styles.appRow}>
        <View style={styles.appRowLeft}>
          <Text style={styles.appIcon}>🟠</Text>
          <View>
            <Text style={styles.appName}>Strava</Text>
            <Text style={styles.appStatus}>
              {syncing
                ? 'Syncing…'
                : stravaConnected
                  ? (stravaAthleteName ? `Connected · ${stravaAthleteName}` : 'Connected')
                  : 'Not connected'}
            </Text>
          </View>
        </View>
        {stravaConnected
          ? <View style={[styles.connectedBadge, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}><RivalIcon name="check" size={12} color={RivalColors.tertiary} /><Text style={styles.connectedBadgeText}>Connected</Text></View>
          : <RivalButton label="Connect" onPress={() => router.push('/home')} variant="secondary" style={styles.appConnectBtn} />}
      </View>

      {stravaConnected && (
        <>
          <RivalButton
            label={syncing ? 'Syncing…' : 'Sync now'}
            onPress={syncNow}
            disabled={syncing}
            variant="secondary"
            style={styles.actionBtn}
          />
          <RivalButton
            label={importingHistory ? 'Importing…' : 'Import full Strava history'}
            onPress={importFullHistory}
            disabled={importingHistory}
            variant="secondary"
            style={styles.actionBtn}
          />
          {!confirmingDisconnect ? (
            <RivalButton
              label="Disconnect Strava"
              onPress={() => setConfirmingDisconnect(true)}
              variant="destructive"
              style={styles.actionBtn}
            />
          ) : (
            <RivalCard style={styles.disconnectConfirmCard}>
              <Text style={styles.disconnectConfirmTitle}>Keep the imported activities?</Text>
              <Text style={styles.disconnectConfirmSub}>
                If this Strava connection was a mistake (e.g. the wrong account got linked), remove the activities it imported too — not just the connection.
              </Text>
              <RivalButton label={disconnecting ? '…' : 'Just disconnect'} onPress={() => disconnectStrava(false)} disabled={disconnecting} variant="destructive" style={styles.disconnectConfirmBtn} />
              <RivalButton label={disconnecting ? '…' : 'Disconnect & remove imported activities'} onPress={() => disconnectStrava(true)} disabled={disconnecting} variant="destructive" style={styles.disconnectConfirmBtn} />
              <TouchableOpacity onPress={() => setConfirmingDisconnect(false)} disabled={disconnecting}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </RivalCard>
          )}
        </>
      )}

      <View style={styles.comingSoonRow}>
        <View style={styles.appRowLeft}>
          <Text style={styles.appIcon}>⌚</Text>
          <View>
            <Text style={styles.appName}>Garmin · Apple Health</Text>
            <Text style={styles.appStatus}>Connection coming soon</Text>
          </View>
        </View>
      </View>
    </RivalCard>
  );

  const notificationsPanel = (
    <RivalCard glass style={styles.panel}>
      <Text style={styles.panelTitle}>Notifications</Text>
      <Text style={styles.panelSub}>Choose what RIVAL pings you about.</Text>
      <View style={styles.comingSoonBox}>
        <RivalIcon name="notifications" size={40} color={RivalColors.textSecondary} />
        <Text style={styles.comingSoonTitle}>Coming soon</Text>
        <Text style={styles.comingSoonText}>
          Fine-grained notification controls are on the way. For now, RIVAL only
          notifies you about the things that matter — milestones and encouragement
          from your teams.
        </Text>
      </View>
    </RivalCard>
  );

  const accountPanel = (
    <RivalCard glass style={styles.panel}>
      <Text style={styles.panelTitle}>Account</Text>

      <View style={styles.accountMetaRow}>
        <Text style={styles.accountMetaLabel}>Member since</Text>
        <Text style={styles.accountMetaValue}>{memberSince || '—'}</Text>
      </View>

      {isAdmin && (
        <RivalButton label="Scoring Config" onPress={() => router.push('/admin')} variant="secondary" style={styles.actionBtn} />
      )}
      <RivalButton label="Sign Out" onPress={handleSignOut} variant="secondary" style={styles.actionBtn} />

      <View style={styles.dangerZone}>
        <Text style={styles.dangerTitle}>DANGER ZONE</Text>
        <TouchableOpacity style={styles.deleteAccountButton} onPress={handleDeleteAccount} disabled={deletingAccount}>
          <Text style={styles.deleteAccountText}>{deletingAccount ? 'Deleting account…' : 'Delete account'}</Text>
        </TouchableOpacity>
      </View>
    </RivalCard>
  );

  const panelFor: Record<TabId, React.ReactNode> = {
    personal: personalPanel,
    apps: appsPanel,
    notifications: notificationsPanel,
    account: accountPanel,
  };

  const sidebar = (
    <View style={[styles.sidebar, wide && styles.sidebarWide]}>
      {TABS.map((t) => {
        const active = activeTab === t.id;
        return (
          <TouchableOpacity
            key={t.id}
            style={[styles.sidebarBtn, wide && styles.sidebarBtnWide, active && styles.sidebarBtnActive]}
            onPress={() => setActiveTab(t.id)}
          >
            <RivalIcon name={t.icon} size={16} color={active ? RivalColors.accentText : RivalColors.textSecondary} />
            <Text style={[styles.sidebarLabel, active && { color: RivalColors.accentText }]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <RivalTopNav />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handlePullToRefresh} tintColor={RivalColors.accentText} colors={[RivalColors.accentFill]} />}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={{ width: 48 }} />
        </View>

        {wide ? (
          <View style={styles.wideRow}>
            {sidebar}
            <View style={styles.wideContent}>{panelFor[activeTab]}</View>
          </View>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabScrollContent}>
              {sidebar}
            </ScrollView>
            {panelFor[activeTab]}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: RivalColors.textSecondary, fontSize: 16 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  back: { color: RivalColors.accentText, fontSize: 16, width: 48 },
  headerTitle: { ...RivalType.titleMd, color: RivalColors.textPrimary },

  wideRow: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  wideContent: { flex: 1 },

  // Sidebar
  sidebar: { gap: 8 },
  sidebarWide: { width: '22%', minWidth: 200, maxWidth: 280, flexGrow: 0, flexShrink: 0 },
  tabScroll: { marginBottom: 16, flexGrow: 0 },
  tabScrollContent: { flexDirection: 'row', gap: 8 },
  sidebarBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: RivalRadius.DEFAULT, backgroundColor: RivalColors.surfaceContainer },
  sidebarBtnWide: { width: '100%' },
  sidebarBtnActive: { backgroundColor: RivalColors.surfaceContainerHigh, borderWidth: 1, borderColor: `${RivalColors.accentFill}44` },
  sidebarIcon: { fontSize: 16 },
  sidebarLabel: { fontSize: 14, fontWeight: '600', color: RivalColors.textSecondary },

  // Panels
  panel: { gap: 8, padding: 20 },
  panelTitle: { ...RivalType.titleMd, color: RivalColors.textPrimary },
  panelSub: { fontSize: 13, color: RivalColors.textSecondary, marginBottom: 8 },

  // Personal info
  personalTop: { gap: 20 },
  personalTopWide: { flexDirection: 'row', alignItems: 'flex-start' },
  avatarWrap: { position: 'relative', alignSelf: 'center' },
  avatar: { width: 112, height: 112, borderRadius: 56, backgroundColor: RivalColors.accentFill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 2, borderColor: RivalColors.outlineVariant },
  avatarImage: { width: 112, height: 112, borderRadius: 56 },
  avatarText: { fontSize: 44, fontWeight: '700', color: RivalColors.onAccentFill },
  avatarEditBadge: { position: 'absolute', bottom: 2, right: 2, backgroundColor: RivalColors.accentFill, borderRadius: 14, width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: RivalColors.surfaceHigh },
  avatarEditText: { fontSize: 12 },

  fieldsCol: { flex: 1, gap: 16, width: '100%' },
  field: { gap: 6 },
  fieldLabel: { ...RivalType.labelCaps, fontSize: 11, color: RivalColors.textSecondary },
  readField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 14, paddingVertical: 12 },
  readFieldDisabled: { opacity: 0.6 },
  readFieldValue: { fontSize: 15, color: RivalColors.onSurface, fontWeight: '600' },
  editHint: { fontSize: 14 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 14, paddingVertical: 12, color: RivalColors.textPrimary, fontSize: 15, fontWeight: '600', borderWidth: 1, borderColor: RivalColors.accentFill },
  usernameAt: { fontSize: 18, fontWeight: '700', color: RivalColors.textSecondary },
  saveChip: { backgroundColor: RivalColors.accentFill, paddingHorizontal: 14, paddingVertical: 10, borderRadius: RivalRadius.DEFAULT },
  saveChipText: { color: RivalColors.onAccentFill, fontWeight: '700', fontSize: 14 },
  cancelText: { color: RivalColors.textSecondary, fontSize: 14 },
  errorText: { fontSize: 12, color: RivalColors.error },

  bioInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 14, paddingVertical: 12, color: RivalColors.onSurface, fontSize: 15, minHeight: 84, textAlignVertical: 'top' },
  bioFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bioHint: { fontSize: 11, color: RivalColors.outline, flex: 1 },
  bioCount: { fontSize: 11, color: RivalColors.textSecondary },
  bioSaveRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 14, marginTop: 4 },

  subSection: { marginTop: 20, gap: 4 },
  subSectionTitle: { ...RivalType.labelCaps, color: RivalColors.textSecondary, marginBottom: 8 },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 10, borderRadius: RivalRadius.DEFAULT },
  optionRowActive: { backgroundColor: `${RivalColors.accentFill}11` },
  optionTextWrap: { flex: 1, gap: 2 },
  optionLabel: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary },
  optionSample: { fontSize: 12, color: RivalColors.textSecondary },
  optionCheck: { fontSize: 18, color: RivalColors.textSecondary, marginLeft: 10 },
  quotePreview: { fontSize: 13, color: RivalColors.textSecondary, fontStyle: 'italic', paddingHorizontal: 10, paddingTop: 8 },

  statsLink: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between', marginTop: 20, backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 14, paddingVertical: 14 },
  statsLinkText: { fontSize: 14, fontWeight: '600', color: RivalColors.textPrimary, flex: 1 },
  statsLinkArrow: { fontSize: 18, color: RivalColors.accentText },

  // Connected apps
  appRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, padding: 14, marginTop: 8 },
  appRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  appIcon: { fontSize: 24 },
  appName: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  appStatus: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },
  connectedBadge: { backgroundColor: `${RivalColors.tertiary}22`, borderRadius: RivalRadius.full, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: `${RivalColors.tertiary}55` },
  connectedBadgeText: { color: RivalColors.tertiary, fontSize: 12, fontWeight: '700' },
  appConnectBtn: { paddingHorizontal: 20 },
  comingSoonRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: RivalColors.surfaceLowest, borderRadius: RivalRadius.DEFAULT, padding: 14, marginTop: 10, opacity: 0.7 },
  actionBtn: { marginTop: 10 },
  disconnectConfirmCard: { marginTop: 10, gap: 10, alignItems: 'center' },
  disconnectConfirmBtn: { width: '100%' },
  disconnectConfirmTitle: { color: RivalColors.textPrimary, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  disconnectConfirmSub: { color: RivalColors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  // Notifications
  comingSoonBox: { alignItems: 'center', gap: 8, paddingVertical: 32, paddingHorizontal: 16 },
  comingSoonEmoji: { fontSize: 40 },
  comingSoonTitle: { fontSize: 16, fontWeight: '700', color: RivalColors.textPrimary },
  comingSoonText: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 360 },

  // Account
  accountMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  accountMetaLabel: { fontSize: 14, color: RivalColors.textSecondary },
  accountMetaValue: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary },
  dangerZone: { marginTop: 24, borderTopWidth: 1, borderTopColor: RivalColors.outlineVariant, paddingTop: 16, gap: 8 },
  dangerTitle: { ...RivalType.labelCaps, color: RivalColors.error },
  deleteAccountButton: { alignItems: 'center', paddingVertical: 12 },
  deleteAccountText: { color: RivalColors.error, fontSize: 13, fontWeight: '600' },
});
