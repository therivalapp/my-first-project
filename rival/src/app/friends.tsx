import { useEffect, useState, useCallback } from 'react';
import { RivalColors } from '../constants/rivalTheme';
import { StyleSheet, TouchableOpacity, View, Text, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { formatDisplayName, IdentityUser } from '../lib/identity';
import { RivalIcon, RivalTopNav, RivalPageHeader, RivalBackButton} from '../components/rival';

type UserResult = IdentityUser & {
  id: string;
  isFollowing: boolean;
};

type Friend = IdentityUser & {
  id: string;
  weekly_score: number;
};

function getMondayStart(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function FriendsScreen() {
  const [currentUserId, setCurrentUserId] = useState('');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserResult[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data: { user } } = await getAuthUser();
    if (!user) return;
    setCurrentUserId(user.id);
    await loadFriends(user.id);
    setLoading(false);
  }

  async function loadFriends(userId: string) {
    const { data: followData } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);

    if (!followData || followData.length === 0) {
      setFriends([]);
      return;
    }

    const ids = followData.map((f: any) => f.following_id);

    const { data: usersData } = await supabase
      .from('users')
      .select('id, display_name')
      .in('id', ids);

    if (!usersData) return;

    const weekStart = getMondayStart(new Date());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    // One query for every friend, not one per friend. Activity rows carry
    // user_id, so the week's Effort can be summed per person in memory —
    // otherwise a long friends list fanned out into a request each.
    const { data: acts } = await supabase
      .from('activities')
      .select('user_id, effort_score')
      .in('user_id', usersData.map((u: any) => u.id))
      .gte('started_at', weekStart.toISOString())
      .lt('started_at', weekEnd.toISOString());

    const weeklyByUser: Record<string, number> = {};
    (acts || []).forEach((a: any) => {
      weeklyByUser[a.user_id] = (weeklyByUser[a.user_id] || 0) + (a.effort_score || 0);
    });

    const friendsWithScores = usersData.map((u: any) => ({
      ...u,
      weekly_score: Math.round((weeklyByUser[u.id] || 0) * 10) / 10,
    }));

    friendsWithScores.sort((a, b) => b.weekly_score - a.weekly_score);
    setFriends(friendsWithScores);
  }

  async function search(text: string) {
    setQuery(text);
    if (text.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);

    const { data: followData } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', currentUserId);

    const followingIds = new Set((followData || []).map((f: any) => f.following_id));

    // Name only, deliberately. Matching on email turned this box into an
    // address-book dump: `.or()` with `email.ilike.%q%` meant typing a
    // fragment like "@gmail" returned other people's email addresses, ten at
    // a time, to anyone signed in.
    //
    // Single-column .ilike() rather than .or() also removes a second bug --
    // .or() takes a COMMA-SEPARATED filter string and the query interpolated
    // raw input into it, so searching "Smith, John" split into a third,
    // malformed condition.
    const { data } = await supabase
      .from('users')
      .select('id, display_name')
      .ilike('display_name', `%${text}%`)
      .neq('id', currentUserId)
      .limit(10);

    if (data) {
      setSearchResults(
        data.map((u: any) => ({
          ...u,
          isFollowing: followingIds.has(u.id),
        }))
      );
    }

    setSearching(false);
  }

  async function toggleFollow(user: UserResult) {
    if (user.isFollowing) {
      await supabase
        .from('follows')
        .delete()
        .eq('follower_id', currentUserId)
        .eq('following_id', user.id);
    } else {
      await supabase
        .from('follows')
        .insert({ follower_id: currentUserId, following_id: user.id });
    }

    // Update search results immediately
    setSearchResults((prev) =>
      prev.map((u) => u.id === user.id ? { ...u, isFollowing: !u.isFollowing } : u)
    );

    // Refresh friends list
    await loadFriends(currentUserId);
  }

  function getDisplayName(u: IdentityUser) {
    return formatDisplayName(u);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <RivalTopNav active="today" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        <View style={styles.header}>
          <RivalBackButton onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} color={RivalColors.accentFill} />
        </View>

        <RivalPageHeader title="Friends" subtitle="The people you show up with." />

        {/* Search */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name…"
            placeholderTextColor={RivalColors.textSecondary}
            value={query}
            onChangeText={search}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searching && <ActivityIndicator color={RivalColors.accentFill} style={styles.searchSpinner} />}
        </View>

        {searchResults.length > 0 && (
          <View style={styles.resultsCard}>
            {searchResults.map((user) => (
              <View key={user.id} style={styles.resultRow}>
                <View style={styles.resultInfo}>
                  <Text style={styles.resultName}>{getDisplayName(user)}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.followButton, user.isFollowing && styles.followingButton]}
                  onPress={() => toggleFollow(user)}
                >
                  <Text style={[styles.followButtonText, user.isFollowing && styles.followingButtonText]}>
                    {user.isFollowing ? 'Following' : 'Follow'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Friends list */}
        <Text style={styles.sectionTitle}>Following</Text>

        {loading && <Text style={styles.emptyText}>Loading…</Text>}

        {!loading && friends.length === 0 && (
          <Text style={styles.emptyText}>Search for friends above to follow them.</Text>
        )}

        {friends.map((friend, index) => (
          <View key={friend.id} style={styles.friendRow}>
            <Text style={styles.friendRank}>{index + 1}.</Text>
            <View style={styles.friendInfo}>
              <Text style={styles.friendName}>{getDisplayName(friend)}</Text>
              <Text style={styles.friendSub}>This week</Text>
            </View>
            <Text style={styles.friendScore}>{friend.weekly_score} Effort</Text>
          </View>
        ))}

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
  header: {
    marginBottom: 0,
  },
  back: {
    color: RivalColors.accentFill,
    fontSize: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: RivalColors.textPrimary,
    marginBottom: 20,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 12,
    padding: 14,
    color: RivalColors.textPrimary,
    fontSize: 16,
    borderWidth: 1,
    borderColor: RivalColors.accentText,
  },
  searchSpinner: {
    marginLeft: 12,
  },
  resultsCard: {
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: RivalColors.accentText,
    marginBottom: 24,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: RivalColors.accentText,
  },
  resultInfo: {
    flex: 1,
    gap: 2,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '600',
    color: RivalColors.textPrimary,
  },
  followButton: {
    backgroundColor: RivalColors.accentFill,
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  followingButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: RivalColors.accentFill,
  },
  followButtonText: {
    color: RivalColors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  followingButtonText: {
    color: RivalColors.accentFill,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: RivalColors.textPrimary,
    marginBottom: 14,
    marginTop: 8,
  },
  emptyText: {
    color: RivalColors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 24,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: RivalColors.accentText,
  },
  friendRank: {
    fontSize: 16,
    color: RivalColors.textSecondary,
    width: 24,
    textAlign: 'center',
  },
  friendInfo: {
    flex: 1,
    gap: 2,
  },
  friendName: {
    fontSize: 16,
    fontWeight: '600',
    color: RivalColors.textPrimary,
  },
  friendSub: {
    fontSize: 12,
    color: RivalColors.textSecondary,
  },
  friendScore: {
    fontSize: 18,
    fontWeight: '800',
    color: RivalColors.accentFill,
  },
});
