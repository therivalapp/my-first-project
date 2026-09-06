import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RivalColors, RivalRadius } from '../../constants/rivalTheme';
import { RivalIcon } from './RivalIcon';

function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function addYears(d: Date, n: number): Date { return new Date(d.getFullYear() + n, d.getMonth(), 1); }
function toIsoDate(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function monthGridCells(viewDate: Date): (number | null)[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const leadingBlanks = firstDow === 0 ? 6 : firstDow - 1;
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function chunkWeeks<T>(cells: T[]): T[][] {
  const weeks: T[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// The month-grid picker (Stitch's "Calendar Marker" pattern) — create-team-
// challenge.tsx and create-league.tsx each already had their own copy of
// this exact grid; this is the shared version for its newest consumer,
// RivalDateField, rather than a fourth near-identical copy.
export function RivalCalendarGrid({ value, onChange }: { value: string | null; onChange: (iso: string) => void }) {
  const [viewDate, setViewDate] = useState(() => (value ? new Date(value + 'T00:00:00') : startOfMonth(new Date())));
  const weeks = chunkWeeks(monthGridCells(viewDate));
  const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 };

  return (
    <View style={styles.widget}>
      <View style={styles.headerRow}>
        <View style={styles.navGroup}>
          <TouchableOpacity onPress={() => setViewDate((d) => addYears(d, -1))} hitSlop={hitSlop}>
            <RivalIcon name="yearBack" size={16} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setViewDate((d) => addMonths(d, -1))} hitSlop={hitSlop}>
            <RivalIcon name="monthBack" size={16} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        </View>
        <Text style={styles.monthLabel}>{viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
        <View style={styles.navGroup}>
          <TouchableOpacity onPress={() => setViewDate((d) => addMonths(d, 1))} hitSlop={hitSlop}>
            <RivalIcon name="monthForward" size={16} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setViewDate((d) => addYears(d, 1))} hitSlop={hitSlop}>
            <RivalIcon name="yearForward" size={16} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.daysRow}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} style={styles.dayLabel}>{d}</Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={styles.daysRow}>
          {week.map((day, di) => {
            if (day === null) return <View key={di} style={styles.dayCell} />;
            const cellIso = toIsoDate(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
            const isSelected = value === cellIso;
            return (
              <TouchableOpacity key={di} style={[styles.dayCell, isSelected && styles.dayCellActive]} onPress={() => onChange(cellIso)}>
                <Text style={[styles.dayNum, isSelected && styles.dayNumActive]}>{day}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  widget: { gap: 6, width: '100%' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  monthLabel: { fontSize: 13, fontWeight: '700', color: RivalColors.textPrimary },
  daysRow: { flexDirection: 'row', gap: 2 },
  dayLabel: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.4)' },
  dayCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: RivalRadius.sm, borderWidth: 1, borderColor: 'transparent' },
  dayCellActive: { backgroundColor: 'rgba(217,119,87,0.18)', borderColor: RivalColors.accentFill },
  dayNum: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  dayNumActive: { color: RivalColors.accentText, fontWeight: '700' },
});
