import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/** Register this device for push (native only) and store the Expo token on the profile. */
export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return; // needs an EAS project id (eas init)
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('urgent', { name: 'Breakdowns', importance: Notifications.AndroidImportance.MAX });
  }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await supabase.from('profiles').update({ expo_push_token: token }).eq('id', userId);
}
