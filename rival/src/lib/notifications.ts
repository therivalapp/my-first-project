import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase, getAuthUser } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  // Push notifications only work on physical devices
  if (!Device.isDevice) return null;
  if (Platform.OS === 'web') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'RIVAL',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId
      ?? Constants.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

    const { data: { user } } = await getAuthUser();
    if (user && token) {
      // Background registration — never interrupt the athlete for this, but a
      // silent failure here means push notifications simply never arrive, with
      // nothing anywhere to say why.
      const { error: tokenErr } = await supabase.from('push_tokens').upsert(
        { user_id: user.id, token, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
      if (tokenErr) console.error('Push token registration failed:', tokenErr.message);
    }

    return token;
  } catch {
    // EAS project not configured yet — push won't work until native build is set up
    return null;
  }
}
