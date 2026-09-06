import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ConfirmOptions, setAlertListener, setConfirmListener } from '../../lib/alertBus';
import { RivalColors, RivalRadius, RivalSerifFamily } from '../../constants/rivalTheme';

// Mounted once at the app root (_layout.tsx). Replaces window.alert's flat
// white browser dialog — notify() hands off here via alertBus so every
// existing notify() call site (14 files) gets this look for free, no
// per-call-site changes needed.
export function RivalAlertHost() {
  const [alert, setAlert] = useState<{ title: string; message?: string } | null>(null);
  // The confirm carries its resolver with it, so dismissing by any route
  // (button, back gesture) always settles the promise the caller is awaiting
  // — a confirm that never resolves would hang the call site forever.
  const [confirm, setConfirm] = useState<{ opts: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);

  useEffect(() => {
    setAlertListener((title, message) => setAlert({ title, message }));
    setConfirmListener((opts, resolve) => setConfirm({ opts, resolve }));
    return () => { setAlertListener(null); setConfirmListener(null); };
  }, []);

  function settle(ok: boolean) {
    confirm?.resolve(ok);
    setConfirm(null);
  }

  if (confirm) {
    const { opts } = confirm;
    return (
      <Modal transparent visible animationType="fade" onRequestClose={() => settle(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>{opts.title}</Text>
            {opts.message ? <Text style={styles.message}>{opts.message}</Text> : null}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => settle(false)}>
                <Text style={styles.cancelBtnText}>{opts.cancelLabel ?? 'Cancel'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.closeBtn, styles.actionBtn, opts.destructive && styles.destructiveBtn]}
                onPress={() => settle(true)}
              >
                <Text style={[styles.closeBtnText, opts.destructive && styles.destructiveBtnText]}>
                  {opts.confirmLabel ?? 'Confirm'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  if (!alert) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => setAlert(null)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{alert.title}</Text>
          {alert.message ? <Text style={styles.message}>{alert.message}</Text> : null}
          <TouchableOpacity style={styles.closeBtn} onPress={() => setAlert(null)}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: RivalColors.surfaceHigh,
    borderRadius: RivalRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 24,
    gap: 10,
  },
  title: {
    fontFamily: RivalSerifFamily,
    fontStyle: 'italic',
    fontWeight: '700',
    fontSize: 19,
    color: RivalColors.textPrimary,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    color: RivalColors.textSecondary,
  },
  closeBtn: {
    marginTop: 12,
    alignSelf: 'flex-end',
    borderWidth: 1.5,
    borderColor: RivalColors.accentFill,
    borderRadius: RivalRadius.full,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  closeBtnText: {
    color: RivalColors.accentText,
    fontSize: 14,
    fontWeight: '700',
  },
  actions: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
  },
  // Cancels its own alignSelf/marginTop — inside `actions` the row does the
  // positioning, and keeping them would push this button out of line with
  // its sibling.
  actionBtn: { marginTop: 0, alignSelf: 'auto' },
  // Deliberately quieter than the confirm: an unbordered text button, so the
  // outlined pill next to it is the one the eye lands on.
  cancelBtn: { paddingHorizontal: 12, paddingVertical: 10 },
  cancelBtnText: {
    color: RivalColors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  destructiveBtn: { borderColor: RivalColors.error },
  destructiveBtnText: { color: RivalColors.error },
});
