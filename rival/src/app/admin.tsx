import { useEffect, useState } from 'react';
import { RivalColors } from '../constants/rivalTheme';
import { StyleSheet, TouchableOpacity, View, Text, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notify';

type ScoringRow = {
  activity_type: string;
  multiplier: number;
  editing: boolean;
  draft: string;
};

export default function AdminScreen() {
  const [rows, setRows] = useState<ScoringRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [newType, setNewType] = useState('');
  const [newMultiplier, setNewMultiplier] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/home'); return; }

    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!userData?.is_admin) { router.replace('/home'); return; }
    setIsAdmin(true);

    const { data } = await supabase
      .from('scoring_config')
      .select('activity_type, multiplier')
      .order('activity_type');

    if (data) {
      setRows(data.map((r: any) => ({ ...r, editing: false, draft: String(r.multiplier) }))
        .sort((a: ScoringRow, b: ScoringRow) => b.multiplier - a.multiplier));
    }
    setLoading(false);
  }

  function startEdit(type: string) {
    setRows((prev) => prev.map((r) => r.activity_type === type ? { ...r, editing: true } : r));
  }

  function updateDraft(type: string, val: string) {
    setRows((prev) => prev.map((r) => r.activity_type === type ? { ...r, draft: val } : r));
  }

  async function saveRow(type: string) {
    const row = rows.find((r) => r.activity_type === type);
    if (!row) return;
    const val = parseFloat(row.draft);
    if (isNaN(val) || val <= 0) return;

    setSaving(type);
    const { error } = await supabase
      .from('scoring_config')
      .update({ multiplier: val })
      .eq('activity_type', type);

    if (!error) {
      setRows((prev) => prev.map((r) =>
        r.activity_type === type ? { ...r, multiplier: val, editing: false } : r
      ).sort((a, b) => b.multiplier - a.multiplier));
    }
    setSaving(null);
  }

  function cancelEdit(type: string) {
    setRows((prev) => prev.map((r) =>
      r.activity_type === type ? { ...r, editing: false, draft: String(r.multiplier) } : r
    ));
  }

  async function addRow() {
    const type = newType.trim();
    const val = parseFloat(newMultiplier);
    if (!type || isNaN(val) || val <= 0) return;
    if (rows.find((r) => r.activity_type.toLowerCase() === type.toLowerCase())) return;

    setAdding(true);
    const { error } = await supabase
      .from('scoring_config')
      .insert({ activity_type: type, multiplier: val });

    if (!error) {
      setRows((prev) => [...prev, { activity_type: type, multiplier: val, editing: false, draft: String(val) }]
        .sort((a, b) => b.multiplier - a.multiplier));
      setNewType('');
      setNewMultiplier('');
    }
    setAdding(false);
  }

  async function deleteRow(type: string) {
    const { error } = await supabase.from('scoring_config').delete().eq('activity_type', type);
    if (error) { notify("Couldn't reset that scoring rule", error.message); return; }
    setRows((prev) => prev.filter((r) => r.activity_type !== type));
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color={RivalColors.accentFill} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>Scoring Config</Text>
        <Text style={styles.subtitle}>
          Changes apply to new activities only. Tap a multiplier to edit.
        </Text>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, { flex: 1 }]}>Activity</Text>
            <Text style={[styles.tableHeaderText, { width: 100, textAlign: 'right' }]}>Multiplier</Text>
          </View>

          {rows.map((row) => (
            <View key={row.activity_type} style={styles.tableRow}>
              <Text style={styles.activityType}>{row.activity_type}</Text>

              {row.editing ? (
                <View style={styles.editCell}>
                  <TextInput
                    style={styles.multiplierInput}
                    value={row.draft}
                    onChangeText={(v) => updateDraft(row.activity_type, v)}
                    keyboardType="decimal-pad"
                    autoFocus
                    selectTextOnFocus
                  />
                  <TouchableOpacity
                    onPress={() => saveRow(row.activity_type)}
                    style={styles.saveBtn}
                    disabled={saving === row.activity_type}
                  >
                    <Text style={styles.saveBtnText}>
                      {saving === row.activity_type ? '…' : '✓'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => cancelEdit(row.activity_type)}>
                    <Text style={styles.cancelText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.rowActions}>
                  <TouchableOpacity onPress={() => startEdit(row.activity_type)} style={styles.multiplierCell}>
                    <Text style={styles.multiplierValue}>×{row.multiplier}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteRow(row.activity_type)} style={styles.deleteBtn}>
                    <Text style={styles.deleteText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Add new activity type */}
        <Text style={styles.addTitle}>Add Activity Type</Text>
        <View style={styles.addRow}>
          <TextInput
            style={styles.addTypeInput}
            placeholder="e.g. Pilates"
            placeholderTextColor={RivalColors.textSecondary}
            value={newType}
            onChangeText={setNewType}
            autoCapitalize="words"
          />
          <TextInput
            style={styles.addMultiplierInput}
            placeholder="×"
            placeholderTextColor={RivalColors.textSecondary}
            value={newMultiplier}
            onChangeText={setNewMultiplier}
            keyboardType="decimal-pad"
          />
          <TouchableOpacity
            style={[styles.addBtn, (!newType || !newMultiplier) && styles.addBtnDisabled]}
            onPress={addRow}
            disabled={adding || !newType || !newMultiplier}
          >
            <Text style={styles.addBtnText}>{adding ? '…' : '+ Add'}</Text>
          </TouchableOpacity>
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
  header: {
    marginBottom: 24,
  },
  back: {
    color: RivalColors.accentFill,
    fontSize: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: RivalColors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: RivalColors.textSecondary,
    marginBottom: 28,
    lineHeight: 18,
  },
  table: {
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: RivalColors.accentText,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: RivalColors.accentText,
    backgroundColor: RivalColors.surfaceLow,
  },
  tableHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: RivalColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#3d1a6e',
  },
  activityType: {
    flex: 1,
    fontSize: 15,
    color: RivalColors.textPrimary,
    fontWeight: '500',
  },
  multiplierCell: {
    width: 100,
    alignItems: 'flex-end',
  },
  multiplierValue: {
    fontSize: 15,
    fontWeight: '700',
    color: RivalColors.accentFill,
  },
  editCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  multiplierInput: {
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: RivalColors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: RivalColors.accentFill,
    width: 64,
    textAlign: 'center',
  },
  saveBtn: {
    backgroundColor: RivalColors.accentFill,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  saveBtnText: {
    color: RivalColors.textPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  cancelText: {
    color: RivalColors.textSecondary,
    fontSize: 16,
    paddingHorizontal: 4,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteBtn: {
    paddingHorizontal: 4,
  },
  deleteText: {
    fontSize: 16,
  },
  addTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: RivalColors.textPrimary,
    marginTop: 28,
    marginBottom: 12,
  },
  addRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  addTypeInput: {
    flex: 1,
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: RivalColors.textPrimary,
    fontSize: 15,
    borderWidth: 1,
    borderColor: RivalColors.accentText,
  },
  addMultiplierInput: {
    width: 64,
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: RivalColors.textPrimary,
    fontSize: 15,
    borderWidth: 1,
    borderColor: RivalColors.accentText,
    textAlign: 'center',
  },
  addBtn: {
    backgroundColor: RivalColors.accentFill,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  addBtnDisabled: {
    opacity: 0.4,
  },
  addBtnText: {
    color: RivalColors.textPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
});
