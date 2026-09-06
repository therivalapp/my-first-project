import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  Image, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notify';
import { formatDisplayName } from '../lib/identity';
import { invalidateUnreadChats } from '../lib/unreadChats';
import { RivalIcon, RivalBackButton } from '../components/rival';
import { RivalColors, RivalRadius } from '../constants/rivalTheme';

// Dedicated team chat, laid out the way Messenger does it.
//
// Chat used to be a TAB inside league.tsx, so it inherited that screen's
// scrolling page: the composer sat mid-page with the invite-code panel showing
// underneath it. A conversation needs a fixed frame — header, scrolling
// transcript, pinned composer — which is a page, not a tab.
//
// The Messenger conventions worth copying, and why:
//   - Consecutive messages from one person GROUP. Repeating the name and
//     avatar on every line is noise when it's the same person three times.
//   - The avatar sits on the LAST bubble of a group, vertically centred on
//     that bubble's first line, with the rest of the group indented to match.
//   - NO per-message timestamp. A centred separator appears only when there's
//     a real gap in the conversation; tapping a bubble reveals its own time.
//     Timestamps on every line compete with the words for attention.
//   - Corners tighten between bubbles inside a group, so a run reads as one
//     block of speech rather than three separate cards.

type Msg = {
  id: string;
  user_id: string;
  kind: string;
  body: string | null;
  activity_type: string | null;
  scheduled_at: string | null;
  location: string | null;
  created_at: string;
  reply_to_id: string | null;
};

type Member = { user_id: string; users: { display_name: string | null; avatar_url?: string | null } | null };

// Gap after which the conversation is treated as having resumed rather than
// continued, and a time separator is shown.
const SEPARATOR_GAP_MS = 60 * 60 * 1000;
// Within this, consecutive messages from one person are one group.
const GROUP_GAP_MS = 5 * 60 * 1000;

// Reactions, chosen deliberately. Messenger's set is ❤️😂😮😢😡 — half of it is
// dismay, shock and anger. RIVAL's whole premise is that effort deserves to be
// acknowledged, so there is no reaction here for mocking or pitying what
// someone posted. Every one of these says some version of "I saw that, and
// it counted".
const REACTIONS = ['❤️', '🔥', '⚡', '💪', '👏', '🙌'] as const;
// What a double-tap gives, and what pre-emoji rows are shown as.
const DEFAULT_REACTION = '❤️';
const DOUBLE_TAP_MS = 280;

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' });
}

function separatorLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const time = timeLabel(iso);
  if (same(d, today)) return time;
  if (same(d, yest)) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

// How much of the window the on-screen keyboard (plus Safari's own form
// accessory bar) is covering.
//
// KeyboardAvoidingView does nothing on react-native-web — it has no keyboard
// events to listen to. On iOS the keyboard shrinks the VISUAL viewport while
// leaving window.innerHeight alone, so the difference between the two is the
// covered height. Without this the composer stayed pinned to the bottom of a
// window that was no longer visible, leaving dead space above the keyboard.
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const update = () => {
      // Measure against the APP's height, not window.innerHeight. +html.tsx
      // sets html/body/#root to 100vh because on iOS standalone the layout
      // viewport is 59px SHORTER than the real screen (793 vs 852, measured
      // on device). window.innerHeight reports that short layout value, so
      // using it under-lifted the composer by exactly that 59px — which is
      // what left the input pill half-buried behind the keyboard toolbar.
      const root = document.getElementById('root');
      const appHeight = root?.getBoundingClientRect().height || window.innerHeight;
      setInset(Math.max(0, appHeight - vv.height - vv.offsetTop));
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();

  const [teamName, setTeamName] = useState('');
  const [teamLogo, setTeamLogo] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [rsvpMap, setRsvpMap] = useState<Record<string, string[]>>({});
  const [currentUserId, setCurrentUserId] = useState('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [showTimeFor, setShowTimeFor] = useState<string | null>(null);
  // messageId -> emoji -> userIds
  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>({});
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  // userId -> the last message they have read, for the seen-by avatars.
  const [seenBy, setSeenBy] = useState<Record<string, string[]>>({});
  const [sessionsOnly, setSessionsOnly] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const editorRef = useRef<any>(null);
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  const tapTimer = useRef<any>(null);
  const canSend = !!input.trim() && !sending;

  useEffect(() => { init(); }, [id]);

  async function init() {
    if (!id) { setLoading(false); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/sign-in'); return; }
    setCurrentUserId(user.id);

    const [teamRes, memberRes, readRes] = await Promise.all([
      supabase.from('leagues').select('name, logo_url').eq('id', id).maybeSingle(),
      supabase.from('league_members').select('user_id, users(display_name, avatar_url)').eq('league_id', id).eq('status', 'active'),
      supabase.from('league_chat_reads').select('last_read_at').eq('league_id', id).eq('user_id', user.id).maybeSingle(),
    ]);

    setTeamName(teamRes.data?.name ?? 'Team');
    setTeamLogo(teamRes.data?.logo_url ?? null);
    setMembers((memberRes.data as any) ?? []);

    const loaded = await loadMessages();

    // Work out the divider BEFORE writing the new read marker, otherwise
    // there is nothing left to mark as new.
    const lastReadAt = readRes.data?.last_read_at;
    const firstNew = loaded.find((m) => m.user_id !== user.id && (!lastReadAt || new Date(m.created_at) > new Date(lastReadAt)));
    setFirstUnreadId(firstNew?.id ?? null);

    await markRead(user.id);
    setLoading(false);
  }

  async function loadMessages(): Promise<Msg[]> {
    const { data, error: loadError } = await supabase
      .from('league_messages')
      .select('id, user_id, kind, body, activity_type, scheduled_at, location, created_at')
      .eq('league_id', id)
      .order('created_at', { ascending: true })
      .limit(200);

    if (loadError) { setError(loadError.message); return []; }
    const rows = (data ?? []) as Msg[];
    setMessages(rows);

    const ids = rows.map((m) => m.id);
    if (ids.length > 0) {
      const { data: rows2 } = await supabase
        .from('league_message_reactions')
        .select('message_id, user_id, kind')
        .in('message_id', ids);
      const map: Record<string, Record<string, string[]>> = {};
      (rows2 ?? []).forEach((r: any) => {
        // 'like' predates the emoji set; show those as the default heart.
        const emoji = r.kind === 'like' ? DEFAULT_REACTION : r.kind;
        ((map[r.message_id] ??= {})[emoji] ??= []).push(r.user_id);
      });
      setReactions(map);
    }

    await loadSeenBy(rows);

    const sessionIds = rows.filter((m) => m.kind === 'session').map((m) => m.id);
    if (sessionIds.length > 0) {
      const { data: rsvps } = await supabase
        .from('league_session_rsvps')
        .select('message_id, user_id')
        .in('message_id', sessionIds);
      const map: Record<string, string[]> = {};
      (rsvps ?? []).forEach((r: any) => { (map[r.message_id] ??= []).push(r.user_id); });
      setRsvpMap(map);
    }
    return rows;
  }

  // Seen-by: for each teammate, find the newest message their read marker
  // covers, and hang their avatar on it. Reading other people's markers only
  // became possible with the teammates policy added alongside this feature.
  async function loadSeenBy(rows: Msg[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: reads } = await supabase
      .from('league_chat_reads')
      .select('user_id, last_read_at')
      .eq('league_id', id);

    const map: Record<string, string[]> = {};
    (reads ?? []).forEach((r: any) => {
      if (r.user_id === user.id || !r.last_read_at) return;
      const seenTs = new Date(r.last_read_at).getTime();
      let lastSeen: Msg | null = null;
      for (const m of rows) {
        // Your own messages are the ones worth knowing were seen, but a
        // teammate "seeing" their own message tells you nothing.
        if (m.user_id === r.user_id) continue;
        if (new Date(m.created_at).getTime() <= seenTs) lastSeen = m;
      }
      if (lastSeen) (map[lastSeen.id] ??= []).push(r.user_id);
    });
    setSeenBy(map);
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!currentUserId) return;
    setPickerFor(null);
    const mine = reactions[messageId]?.[emoji] ?? [];
    const had = mine.includes(currentUserId);

    // Optimistic; reloaded if the write fails, because an RLS refusal comes
    // back as a silent no-op rather than an exception.
    setReactions((p) => {
      const forMsg = { ...(p[messageId] ?? {}) };
      const list = forMsg[emoji] ?? [];
      forMsg[emoji] = had ? list.filter((u) => u !== currentUserId) : [...list, currentUserId];
      if (forMsg[emoji].length === 0) delete forMsg[emoji];
      return { ...p, [messageId]: forMsg };
    });

    if (had) {
      const { error: delErr } = await supabase.from('league_message_reactions')
        .delete().eq('message_id', messageId).eq('user_id', currentUserId).eq('kind', emoji);
      if (delErr) { notify("Couldn't remove that reaction", delErr.message); loadMessages(); }
    } else {
      // One reaction per person per message, like Messenger: swapping emoji
      // replaces rather than stacks.
      await supabase.from('league_message_reactions')
        .delete().eq('message_id', messageId).eq('user_id', currentUserId);
      const { error: insErr } = await supabase.from('league_message_reactions')
        .insert({ message_id: messageId, user_id: currentUserId, kind: emoji });
      if (insErr) { notify("Couldn't add that reaction", insErr.message); loadMessages(); }
    }
  }

  // RN has no double-tap gesture, so a single tap waits briefly to see if a
  // second one lands before it acts.
  function onBubblePress(msg: Msg) {
    const now = Date.now();
    if (lastTap.current?.id === msg.id && now - lastTap.current.at < DOUBLE_TAP_MS) {
      clearTimeout(tapTimer.current);
      lastTap.current = null;
      setShowTimeFor(null);
      toggleReaction(msg.id, DEFAULT_REACTION);
      return;
    }
    lastTap.current = { id: msg.id, at: now };
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      setShowTimeFor((c) => (c === msg.id ? null : msg.id));
    }, DOUBLE_TAP_MS);
  }

  async function markRead(userId: string) {
    await supabase.from('league_chat_reads').upsert(
      { league_id: id, user_id: userId, last_read_at: new Date().toISOString() },
      { onConflict: 'league_id,user_id' },
    );
    invalidateUnreadChats();
  }

  async function send() {
    const body = input.trim();
    if (!body || !currentUserId || !id) return;
    setSending(true);
    setError('');
    const { error: sendError } = await supabase
      .from('league_messages')
      .insert({ league_id: id, user_id: currentUserId, kind: 'text', body, reply_to_id: replyTo?.id ?? null });
    setSending(false);
    if (sendError) { setError(sendError.message); return; }
    setInput('');
    setReplyTo(null);
    if (editorRef.current) editorRef.current.textContent = '';
    setFirstUnreadId(null);
    setSessionsOnly(false);
    await loadMessages();
    await markRead(currentUserId);
  }

  async function toggleRsvp(messageId: string) {
    if (!currentUserId) return;
    const joined = (rsvpMap[messageId] ?? []).includes(currentUserId);
    // RLS failures are silent no-ops, so the error branch reloads rather than
    // trusting the optimistic update it just made.
    if (joined) {
      const { error: outErr } = await supabase.from('league_session_rsvps')
        .delete().eq('message_id', messageId).eq('user_id', currentUserId);
      if (outErr) { notify("Couldn't update your RSVP", outErr.message); loadMessages(); return; }
      setRsvpMap((p) => ({ ...p, [messageId]: (p[messageId] ?? []).filter((u) => u !== currentUserId) }));
    } else {
      const { error: inErr } = await supabase.from('league_session_rsvps')
        .insert({ message_id: messageId, user_id: currentUserId });
      if (inErr) { notify("Couldn't update your RSVP", inErr.message); loadMessages(); return; }
      setRsvpMap((p) => ({ ...p, [messageId]: [...(p[messageId] ?? []), currentUserId] }));
    }
  }

  const memberFor = useCallback((userId: string) => members.find((m) => m.user_id === userId), [members]);
  const nameFor = useCallback((userId: string) => {
    const m = memberFor(userId);
    return m?.users ? formatDisplayName(m.users) : 'Athlete';
  }, [memberFor]);

  const sessionCount = useMemo(() => messages.filter((m) => m.kind === 'session').length, [messages]);
  const visible = useMemo(
    () => (sessionsOnly ? messages.filter((m) => m.kind === 'session') : messages),
    [messages, sessionsOnly],
  );

  // @mentions render in the accent colour rather than as raw "@name" text.
  function renderBody(body: string | null, isMe: boolean) {
    if (!body) return null;
    const parts = body.split(/(@[\w'’-]+(?:\s[\w'’-]+)?)/g);
    return (
      <Text style={styles.msgText}>
        {parts.map((part, i) =>
          part.startsWith('@')
            ? <Text key={i} style={isMe ? styles.mentionMe : styles.mention}>{part}</Text>
            : <Text key={i}>{part}</Text>,
        )}
      </Text>
    );
  }

  function renderSession(msg: Msg) {
    const joiners = rsvpMap[msg.id] ?? [];
    const joined = joiners.includes(currentUserId);
    return (
      <View style={styles.sessionCard}>
        <View style={styles.sessionHead}>
          <RivalIcon name="calendar" size={14} color={RivalColors.accentText} />
          <Text style={styles.sessionKicker}>{(msg.activity_type ?? 'Session').toUpperCase()}</Text>
        </View>
        {!!msg.body && <Text style={styles.sessionTitle}>{msg.body}</Text>}
        {!!msg.scheduled_at && (
          <Text style={styles.sessionWhen}>
            {new Date(msg.scheduled_at).toLocaleString('en-NZ', {
              weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
            })}
          </Text>
        )}
        {!!msg.location && <Text style={styles.sessionWhere}>{msg.location}</Text>}
        <View style={styles.sessionFoot}>
          <Text style={styles.sessionGoing}>
            {joiners.length} {joiners.length === 1 ? 'person' : 'people'} going
          </Text>
          <TouchableOpacity
            style={[styles.rsvpBtn, joined && styles.rsvpBtnOut]}
            onPress={() => toggleRsvp(msg.id)}
          >
            <Text style={[styles.rsvpText, joined && styles.rsvpTextOut]}>
              {joined ? "I'm out" : "I'm in"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <RivalBackButton
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/messages'))}
          color={RivalColors.accentFill}
        />
        {/* Crest before the name: which conversation you're in should be
            recognisable at a glance, the way it is in the teams rail. */}
        <TouchableOpacity onPress={() => router.push({ pathname: '/league', params: { id: String(id) } })}>
          {teamLogo ? (
            <Image source={{ uri: teamLogo }} style={styles.headerLogo} />
          ) : (
            <View style={[styles.headerLogo, styles.headerLogoFallback]}>
              <Text style={styles.headerLogoText}>{teamName.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
        </TouchableOpacity>
        <View style={styles.headerMid}>
          <Text style={styles.headerTitle} numberOfLines={1}>{teamName}</Text>
          <Text style={styles.headerSub}>{members.length} {members.length === 1 ? 'member' : 'members'}</Text>
        </View>
        {/* Meet-ups are the one thing people come back to a chat to FIND, and
            scrolling a transcript for them is the worst way to look. */}
        {sessionCount > 0 && (
          <TouchableOpacity
            onPress={() => setSessionsOnly((v) => !v)}
            style={[styles.headerBtn, sessionsOnly && styles.headerBtnOn]}
            accessibilityLabel={sessionsOnly ? 'Show all messages' : 'Show sessions only'}
          >
            <RivalIcon
              name="calendar"
              size={20}
              color={sessionsOnly ? RivalColors.textPrimary : RivalColors.accentText}
            />
            <View style={styles.headerBtnCount}>
              <Text style={styles.headerBtnCountText}>{sessionCount}</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {sessionsOnly && (
        <TouchableOpacity style={styles.filterBanner} onPress={() => setSessionsOnly(false)}>
          <Text style={styles.filterBannerText}>
            Showing sessions only · <Text style={styles.filterBannerAction}>Show everything</Text>
          </Text>
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView
        style={[styles.flex, !!keyboardInset && { marginBottom: keyboardInset }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // SafeAreaView already applies the top inset; adding it here again
        // double-counted it and left a gap between composer and keyboard.
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <View style={styles.centered}><ActivityIndicator color={RivalColors.accentFill} /></View>
        ) : visible.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>{sessionsOnly ? 'No sessions yet' : 'No messages yet'}</Text>
            <Text style={styles.emptyBody}>
              {sessionsOnly
                ? 'When someone plans a meet-up, it shows here.'
                : "Say something — it's how a team stops being a list of names."}
            </Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => { if (!sessionsOnly) scrollRef.current?.scrollToEnd({ animated: false }); }}
          >
            {visible.map((msg, i) => {
              const prev = visible[i - 1];
              const next = visible[i + 1];
              const isMe = msg.user_id === currentUserId;
              const t = new Date(msg.created_at).getTime();

              const gapBefore = prev ? t - new Date(prev.created_at).getTime() : Infinity;
              const showSeparator = gapBefore > SEPARATOR_GAP_MS;

              // Grouping: same author, close in time, and neither side is a
              // session card (those are their own block, never part of a run).
              const groupWithPrev = !!prev && !showSeparator
                && prev.user_id === msg.user_id
                && prev.kind !== 'session' && msg.kind !== 'session'
                && gapBefore <= GROUP_GAP_MS;
              const gapAfter = next ? new Date(next.created_at).getTime() - t : Infinity;
              const groupWithNext = !!next
                && next.user_id === msg.user_id
                && next.kind !== 'session' && msg.kind !== 'session'
                && gapAfter <= GROUP_GAP_MS
                && gapAfter <= SEPARATOR_GAP_MS;

              const isFirstOfGroup = !groupWithPrev;
              const isLastOfGroup = !groupWithNext;

              return (
                <View key={msg.id}>
                  {showSeparator && (
                    <View style={styles.sepRow}>
                      <Text style={styles.sepText}>{separatorLabel(msg.created_at)}</Text>
                    </View>
                  )}
                  {firstUnreadId === msg.id && (
                    <View style={styles.newRow}>
                      <View style={styles.newLine} />
                      <Text style={styles.newText}>New</Text>
                      <View style={styles.newLine} />
                    </View>
                  )}

                  {msg.kind === 'session' ? renderSession(msg) : (
                    <View style={[
                      styles.row,
                      isMe && styles.rowMe,
                      groupWithPrev ? styles.rowTight : styles.rowLoose,
                      Object.keys(reactions[msg.id] ?? {}).length > 0 && styles.rowWithReaction,
                    ]}>
                      {!isMe && (
                        // Avatar on the LAST bubble of a run, vertically
                        // centred on THAT bubble's first line of text; the
                        // rest of the run keeps the indent so the column
                        // stays straight.
                        isLastOfGroup ? (
                          <View style={[styles.avatar, isFirstOfGroup && styles.avatarUnderName]}>
                            {memberFor(msg.user_id)?.users?.avatar_url
                              ? <Image source={{ uri: memberFor(msg.user_id)!.users!.avatar_url! }} style={styles.avatarImg} />
                              : <Text style={styles.avatarText}>{nameFor(msg.user_id).slice(0, 2).toUpperCase()}</Text>}
                          </View>
                        ) : <View style={styles.avatarSpacer} />
                      )}
                      <View style={[styles.bubbleWrap, isMe && styles.bubbleWrapMe]}>
                        {!isMe && isFirstOfGroup && <Text style={styles.author}>{nameFor(msg.user_id)}</Text>}
                        {/* Quoted context sits ABOVE the bubble, dimmed, so a
                            reply reads as an answer rather than a new thought. */}
                        {!!msg.reply_to_id && (() => {
                          const src = messages.find((m) => m.id === msg.reply_to_id);
                          return (
                            <View style={[styles.quote, isMe && styles.quoteMe]}>
                              <Text style={styles.quoteName} numberOfLines={1}>
                                {src ? nameFor(src.user_id) : 'Message'}
                              </Text>
                              <Text style={styles.quoteBody} numberOfLines={1}>
                                {src ? (src.kind === 'session' ? 'Session' : src.body) : 'Deleted message'}
                              </Text>
                            </View>
                          );
                        })()}

                        {/* Long-press opens the picker; double-tap hearts it. */}
                        {pickerFor === msg.id && (
                          <View style={[styles.picker, isMe && styles.pickerMe]}>
                            {REACTIONS.map((emoji) => {
                              const active = (reactions[msg.id]?.[emoji] ?? []).includes(currentUserId);
                              return (
                                <TouchableOpacity
                                  key={emoji}
                                  onPress={() => toggleReaction(msg.id, emoji)}
                                  style={[styles.pickerBtn, active && styles.pickerBtnActive]}
                                >
                                  <Text style={styles.pickerEmoji}>{emoji}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        )}

                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => onBubblePress(msg)}
                          onLongPress={() => { clearTimeout(tapTimer.current); setShowTimeFor(null); setPickerFor(msg.id); }}
                          delayLongPress={280}
                        >
                          <View style={[
                            styles.bubble,
                            isMe ? styles.bubbleMe : styles.bubbleThem,
                            // Tighten the corners that face another bubble in
                            // the same run, so the run reads as one block.
                            !isFirstOfGroup && (isMe ? styles.tightTopRight : styles.tightTopLeft),
                            !isLastOfGroup && (isMe ? styles.tightBottomRight : styles.tightBottomLeft),
                          ]}>
                            {renderBody(msg.body, isMe)}
                          </View>
                        </TouchableOpacity>

                        {Object.keys(reactions[msg.id] ?? {}).length > 0 && (
                          <View style={[styles.reactionRow, isMe && styles.reactionRowMe]}>
                            {Object.entries(reactions[msg.id]).map(([emoji, users]) => (
                              <TouchableOpacity
                                key={emoji}
                                style={[styles.reactionPill, users.includes(currentUserId) && styles.reactionPillMine]}
                                onPress={() => toggleReaction(msg.id, emoji)}
                              >
                                <Text style={styles.reactionEmoji}>{emoji}</Text>
                                {users.length > 1 && <Text style={styles.reactionCount}>{users.length}</Text>}
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}

                        {/* One tap opens time + actions together, rather than
                            hiding Reply behind a long-press that has no
                            discoverable equivalent on the web build. */}
                        {showTimeFor === msg.id && (
                          <View style={[styles.actionRow, isMe && styles.actionRowMe]}>
                            <TouchableOpacity
                              onPress={() => { setShowTimeFor(null); setPickerFor(msg.id); }}
                              style={styles.actionBtn}
                            >
                              <RivalIcon name="respect" size={13} color={RivalColors.textSecondary} />
                              <Text style={styles.actionText}>React</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => { setReplyTo(msg); setShowTimeFor(null); }}
                              style={styles.actionBtn}
                            >
                              <RivalIcon name="reply" size={13} color={RivalColors.textSecondary} />
                              <Text style={styles.actionText}>Reply</Text>
                            </TouchableOpacity>
                            <Text style={styles.time}>{timeLabel(msg.created_at)}</Text>
                          </View>
                        )}

                        {/* Seen-by avatars, Messenger-style: tiny, under the
                            newest message that person has read. */}
                        {(seenBy[msg.id]?.length ?? 0) > 0 && (
                          <View style={[styles.seenRow, isMe && styles.seenRowMe]}>
                            {seenBy[msg.id].map((uid) => {
                              const url = memberFor(uid)?.users?.avatar_url;
                              return url ? (
                                <Image key={uid} source={{ uri: url }} style={styles.seenAvatar} />
                              ) : (
                                <View key={uid} style={[styles.seenAvatar, styles.seenAvatarFallback]}>
                                  <Text style={styles.seenAvatarText}>{nameFor(uid).slice(0, 1).toUpperCase()}</Text>
                                </View>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}

        {!!error && <Text style={styles.error}>{error}</Text>}

        {/* Reply target sits above the composer, not inside it, so the text
            you're answering stays visible while you type. */}
        {replyTo && (
          <View style={styles.replyBar}>
            <View style={styles.replyBarText}>
              <Text style={styles.replyBarName}>Replying to {nameFor(replyTo.user_id)}</Text>
              <Text style={styles.replyBarBody} numberOfLines={1}>
                {replyTo.kind === 'session' ? 'Session' : replyTo.body}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)} accessibilityLabel="Cancel reply">
              <RivalIcon name="close" size={18} color={RivalColors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.composer, { paddingBottom: keyboardInset > 0 ? 10 : Math.max(insets.bottom, 10) }]}>
          {/* On web this is a contenteditable div, NOT a TextInput.
              TextInput renders a <textarea>, and iOS Safari attaches its form
              accessory bar (the grey "^ v Done" strip) to every <input> and
              <textarea> on the page — there is no way to suppress it for those.
              It does NOT attach to contenteditable regions, so the keyboard
              comes up clean. Native keeps the real TextInput. */}
          {Platform.OS === 'web' ? (
            <View style={styles.inputWrap}>
              {!input && <Text style={styles.placeholder} pointerEvents="none">Message your team</Text>}
              {React.createElement('div', {
                ref: editorRef,
                contentEditable: true,
                role: 'textbox',
                'aria-label': 'Message your team',
                'aria-multiline': 'true',
                suppressContentEditableWarning: true,
                onInput: (e: any) => setInput(e.currentTarget.textContent ?? ''),
                onKeyDown: (e: any) => {
                  // Enter sends; Shift+Enter is a newline, as in Messenger.
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                },
                onPaste: (e: any) => {
                  // contenteditable accepts rich HTML on paste; force plain text
                  // so pasted styling can't leak into the composer.
                  e.preventDefault();
                  const text = e.clipboardData?.getData('text/plain') ?? '';
                  document.execCommand('insertText', false, text);
                },
                style: webEditorStyle,
              })}
            </View>
          ) : (
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Message your team"
              placeholderTextColor={RivalColors.textSecondary}
              onSubmitEditing={send}
              returnKeyType="send"
              multiline
              numberOfLines={1}
            />
          )}
          <TouchableOpacity
            style={[styles.sendBtn, !canSend && styles.sendBtnOff]}
            onPress={send}
            disabled={!canSend}
            accessibilityLabel="Send"
          >
            <RivalIcon
              name="send"
              size={19}
              color={canSend ? RivalColors.textPrimary : RivalColors.textSecondary}
              // MaterialIcons' paper-plane is drawn low-left inside its box;
              // this re-centres the ink rather than the glyph's advance box.
              style={styles.sendGlyph}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const AVATAR = 28;
// Composer input and send button share one height so they read as a pair.
const COMPOSER_H = 44;

// Plain CSS for the contenteditable composer — it is a real DOM node, not a
// react-native-web component, so it takes a style object rather than a
// StyleSheet entry. Mirrors styles.input exactly.
const webEditorStyle: any = {
  minHeight: COMPOSER_H,
  maxHeight: 120,
  overflowY: 'auto',
  padding: '12px 18px',
  boxSizing: 'border-box',
  color: '#FFFFFF',
  fontSize: 16,          // under 16px iOS zooms the page on focus
  lineHeight: '20px',
  fontFamily: 'inherit',
  outline: 'none',
  // A long unbroken string would otherwise force the composer wider than the
  // screen and push the send button off the edge.
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  whiteSpace: 'pre-wrap',
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: RivalColors.surfaceContainerHigh,
  },
  headerLogo: { width: 34, height: 34, borderRadius: 10, backgroundColor: RivalColors.surfaceContainerHigh },
  headerLogoFallback: { alignItems: 'center', justifyContent: 'center' },
  headerLogoText: { fontSize: 14, fontWeight: '800', color: RivalColors.accentText },
  headerMid: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: RivalColors.textPrimary },
  headerSub: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 1 },
  headerBtn: { padding: 6, borderRadius: 999 },
  headerBtnOn: { backgroundColor: RivalColors.accentFill },
  headerBtnCount: {
    position: 'absolute', top: 0, right: 0,
    minWidth: 15, height: 15, borderRadius: 8, paddingHorizontal: 3,
    backgroundColor: RivalColors.surfaceContainerHigh,
    alignItems: 'center', justifyContent: 'center',
  },
  headerBtnCountText: { fontSize: 9, fontWeight: '800', color: RivalColors.textPrimary },

  filterBanner: {
    paddingVertical: 8, paddingHorizontal: 16,
    backgroundColor: RivalColors.surfaceContainer,
    borderBottomWidth: 1, borderBottomColor: RivalColors.surfaceContainerHigh,
  },
  filterBannerText: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },
  filterBannerAction: { color: RivalColors.accentText, fontWeight: '700' },

  list: { padding: 16, paddingBottom: 24 },

  sepRow: { alignItems: 'center', marginVertical: 14 },
  sepText: { fontSize: 11, fontWeight: '600', color: RivalColors.textSecondary },

  newRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 12 },
  newLine: { flex: 1, height: 1, backgroundColor: `${RivalColors.accentFill}55` },
  newText: { fontSize: 11, fontWeight: '700', color: RivalColors.accentText, letterSpacing: 0.6 },

  // alignItems flex-end pins the avatar to the BOTTOM of the last bubble,
  // which is where Messenger puts it. It used to sit low because a timestamp
  // lived inside this row and the avatar aligned to that instead.
  // flex-start, not flex-end: the avatar is nudged down to sit on the first
  // LINE of the message rather than hanging off the bottom of the bubble,
  // which read as sitting too low on anything longer than one line.
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMe: { justifyContent: 'flex-end' },
  rowLoose: { marginTop: 12 },
  rowTight: { marginTop: 2 },
  // Just enough clearance for the overlapping pill, and only when there is one.
  rowWithReaction: { marginBottom: 8 },

  // Nudged to centre on the first LINE of its bubble: bubble top padding (9)
  // plus half a line (10), minus half the avatar (14) = 5.
  avatar: {
    width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, overflow: 'hidden',
    backgroundColor: RivalColors.surfaceContainerHigh,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 5,
  },
  // A one-message run is both first AND last, so the name label sits above
  // the bubble and the avatar has to clear it: + line (14) + margin (4).
  avatarUnderName: { marginTop: 23 },
  avatarSpacer: { width: AVATAR },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { fontSize: 10, fontWeight: '700', color: RivalColors.textSecondary },

  // minWidth 0 + flexShrink are what make maxWidth actually bind: without
  // them a long unbroken string sets a large intrinsic minimum width and the
  // bubble refuses to shrink, running off the right edge of the screen.
  bubbleWrap: { maxWidth: '76%', minWidth: 0, flexShrink: 1, position: 'relative' },
  bubbleWrapMe: { alignItems: 'flex-end' },
  // Explicit lineHeight so the avatar's nudge above stays correct across
  // platforms instead of depending on a default line box.
  author: { fontSize: 11, lineHeight: 14, fontWeight: '600', color: RivalColors.textSecondary, marginBottom: 4, marginLeft: 12 },

  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleThem: { backgroundColor: RivalColors.surfaceContainer },
  bubbleMe: { backgroundColor: RivalColors.accentFill },
  tightTopLeft: { borderTopLeftRadius: 5 },
  tightBottomLeft: { borderBottomLeftRadius: 5 },
  tightTopRight: { borderTopRightRadius: 5 },
  tightBottomRight: { borderBottomRightRadius: 5 },

  msgText: {
    fontSize: 15, color: RivalColors.textPrimary, lineHeight: 20,
    // A pasted URL or a keyboard-mash has no spaces to wrap at; without this
    // the browser keeps it on one line and the bubble overflows.
    ...(Platform.OS === 'web' ? { overflowWrap: 'anywhere', wordBreak: 'break-word' } as any : null),
  },
  mention: { color: RivalColors.accentText, fontWeight: '700' },
  mentionMe: { fontWeight: '800' },
  time: { fontSize: 10, color: RivalColors.textSecondary, marginTop: 4, marginLeft: 12 },

  quote: {
    borderLeftWidth: 2, borderLeftColor: RivalColors.surfaceContainerHigh,
    paddingLeft: 8, marginLeft: 12, marginBottom: 4, opacity: 0.75, maxWidth: '100%',
  },
  quoteMe: { alignSelf: 'flex-end', marginLeft: 0, marginRight: 12 },
  quoteName: { fontSize: 10, fontWeight: '700', color: RivalColors.accentText },
  quoteBody: { fontSize: 12, color: RivalColors.textSecondary },

  // Floating emoji row, Messenger-style: sits above the bubble it belongs to
  // so your thumb never covers the message you're reacting to.
  picker: {
    flexDirection: 'row', gap: 2, alignSelf: 'flex-start',
    marginLeft: 8, marginBottom: 6,
    backgroundColor: RivalColors.surfaceContainerHigh,
    borderRadius: 999, paddingHorizontal: 6, paddingVertical: 5,
  },
  pickerMe: { alignSelf: 'flex-end', marginLeft: 0, marginRight: 8 },
  pickerBtn: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 999 },
  pickerBtnActive: { backgroundColor: `${RivalColors.accentFill}55` },
  pickerEmoji: { fontSize: 22 },

  // Absolutely positioned so it OVERLAPS the bubble's bottom edge and adds no
  // height of its own. In flow it pushed every bubble apart by a full row,
  // which made three short messages look like a wall.
  // Messenger tucks the pill into the bubble's INNER bottom corner — the edge
  // facing the middle of the screen. So a received message carries it bottom
  // -right, and one of yours carries it bottom-left. Putting it on the outer
  // edge pushes it toward the screen edge, away from the conversation.
  reactionRow: {
    position: 'absolute', bottom: -9, right: 2,
    flexDirection: 'row', gap: 2, zIndex: 2,
  },
  reactionRowMe: { right: undefined, left: 2 },
  reactionPill: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: RivalColors.surfaceContainerHigh,
    // Hugs the glyph: an emoji already carries its own side bearing, so
    // padding on top of that reads as a wide capsule rather than a badge.
    borderRadius: 999, paddingHorizontal: 2, paddingVertical: 1,
  },
  // No ring, so "mine" is carried by the fill instead of an outline.
  reactionPillMine: { backgroundColor: `${RivalColors.accentFill}55` },
  reactionEmoji: { fontSize: 11 },
  reactionCount: { fontSize: 9, fontWeight: '700', color: RivalColors.textSecondary, marginRight: 3 },

  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6, marginLeft: 12 },
  actionRowMe: { justifyContent: 'flex-end', marginLeft: 0, marginRight: 4 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionText: { fontSize: 11, fontWeight: '600', color: RivalColors.textSecondary },

  seenRow: { flexDirection: 'row', gap: 2, marginTop: 4, marginLeft: 12 },
  seenRowMe: { justifyContent: 'flex-end', marginLeft: 0, marginRight: 4 },
  seenAvatar: { width: 14, height: 14, borderRadius: 7, backgroundColor: RivalColors.surfaceContainerHigh },
  seenAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  seenAvatarText: { fontSize: 7, fontWeight: '800', color: RivalColors.textSecondary },
  timeMe: { marginLeft: 0, marginRight: 4 },

  sessionCard: {
    backgroundColor: RivalColors.surfaceContainer,
    borderRadius: RivalRadius.DEFAULT,
    borderWidth: 1, borderColor: `${RivalColors.accentFill}44`,
    padding: 14, gap: 4, marginTop: 12,
  },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sessionKicker: { fontSize: 11, fontWeight: '800', color: RivalColors.accentText, letterSpacing: 0.7 },
  sessionTitle: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  sessionWhen: { fontSize: 13, color: RivalColors.textPrimary },
  sessionWhere: { fontSize: 13, color: RivalColors.textSecondary },
  sessionFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  sessionGoing: { fontSize: 12, color: RivalColors.textSecondary },
  rsvpBtn: { backgroundColor: RivalColors.accentFill, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  rsvpBtnOut: { backgroundColor: 'transparent', borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  rsvpText: { fontSize: 13, fontWeight: '700', color: RivalColors.textPrimary },
  rsvpTextOut: { color: RivalColors.textSecondary },

  error: { color: RivalColors.error, fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 },

  replyBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 18, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: RivalColors.surfaceContainerHigh,
    backgroundColor: RivalColors.surfaceContainer,
  },
  replyBarText: { flex: 1, minWidth: 0 },
  replyBarName: { fontSize: 11, fontWeight: '700', color: RivalColors.accentText },
  replyBarBody: { fontSize: 12, color: RivalColors.textSecondary },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 14, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: RivalColors.surfaceContainerHigh,
    backgroundColor: RivalColors.surfaceLow,
  },
  // minHeight matches the send button exactly (12 + 20 line + 12 = 44), so at
  // rest the two are the same height and the pill radius is a true half-round
  // on both. The box only grows once the text actually wraps.
  input: {
    flex: 1, minWidth: 0,
    minHeight: COMPOSER_H, maxHeight: 120,
    backgroundColor: RivalColors.surfaceContainer,
    borderRadius: COMPOSER_H / 2,
    paddingHorizontal: 18, paddingVertical: 12,
    // 16, not 15: under 16px iOS Safari zooms the page on focus. This is
    // the input people touch most, so it shouldn't rely on the viewport
    // guard in +html.tsx to behave.
    color: RivalColors.textPrimary, fontSize: 16, lineHeight: 20,
    ...(Platform.OS === 'web' ? { resize: 'none', outlineStyle: 'none' } as any : null),
  },
  // Wraps the contenteditable so the pill background, radius and flex
  // behaviour stay in the StyleSheet with everything else.
  inputWrap: {
    flex: 1, minWidth: 0,
    minHeight: COMPOSER_H,
    justifyContent: 'center',
    backgroundColor: RivalColors.surfaceContainer,
    borderRadius: COMPOSER_H / 2,
  },
  placeholder: {
    position: 'absolute', left: 18,
    color: RivalColors.textSecondary, fontSize: 16, lineHeight: 20,
  },
  sendBtn: {
    width: COMPOSER_H, height: COMPOSER_H, borderRadius: COMPOSER_H / 2,
    flexShrink: 0,
    backgroundColor: RivalColors.accentFill,
    alignItems: 'center', justifyContent: 'center',
  },
  // A washed-out 40%-opacity everything read as broken rather than waiting.
  // Muting the fill and the glyph separately keeps it deliberate.
  sendBtnOff: { backgroundColor: RivalColors.surfaceContainerHigh },
  sendGlyph: { marginLeft: -1 },

  emptyTitle: { fontSize: 17, fontWeight: '700', color: RivalColors.textPrimary },
  emptyBody: { fontSize: 14, color: RivalColors.textSecondary, textAlign: 'center', lineHeight: 20 },
});
