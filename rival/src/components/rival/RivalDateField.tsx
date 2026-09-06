import { useState } from 'react';
import { Modal, StyleProp, StyleSheet, TextInput, TextStyle, TouchableOpacity, View, ViewStyle } from 'react-native';
import { RivalColors, RivalRadius } from '../../constants/rivalTheme';
import { displayToIsoDate, isoToDisplayDate, maskDateInput } from '../../lib/dateFormat';
import { RivalIcon } from './RivalIcon';
import { RivalCalendarGrid } from './RivalCalendarGrid';

// A typed DD/MM/YYYY field paired with a calendar button — typing still
// works (auto-slashed via maskDateInput so a missing "/" can't happen), but
// tapping the calendar icon skips typing entirely. `inputStyle` takes each
// screen's own existing input styling so this drops into a differently-
// styled form without homogenizing the whole app's look.
export function RivalDateField({
  value,
  onChangeText,
  placeholder = 'DD/MM/YYYY',
  inputStyle,
  containerStyle,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  inputStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const iso = displayToIsoDate(value);

  return (
    <>
      <View style={[styles.row, containerStyle]}>
        <TextInput
          style={[styles.input, inputStyle]}
          value={value}
          onChangeText={(v) => onChangeText(maskDateInput(v))}
          placeholder={placeholder}
          placeholderTextColor={RivalColors.textSecondary}
          keyboardType="number-pad"
          maxLength={10}
        />
        <TouchableOpacity onPress={() => setOpen(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.calendarBtn}>
          <RivalIcon name="calendar" size={18} color={RivalColors.accentText} />
        </TouchableOpacity>
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          {/* Swallows the tap so it doesn't bubble to the backdrop above and close the sheet mid-pick. */}
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <RivalCalendarGrid
              value={iso}
              onChange={(nextIso) => {
                onChangeText(isoToDisplayDate(nextIso));
                setOpen(false);
              }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1 },
  calendarBtn: {
    width: 40,
    height: 40,
    borderRadius: RivalRadius.DEFAULT,
    backgroundColor: RivalColors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: RivalColors.surfaceHigh,
    borderRadius: RivalRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 20,
  },
});
