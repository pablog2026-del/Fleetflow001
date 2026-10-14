import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { APP_URL, supabase } from './supabase';

/** Opens Stripe Checkout (ACH first, card second) for the given open invoices. */
export async function payInvoices(invoiceIds: string[]): Promise<void> {
  const returnUrl = Platform.OS === 'web' ? `${APP_URL.replace(/\/$/, '')}/accounting` : Linking.createURL('/accounting');
  const { data, error } = await supabase.functions.invoke('create-checkout', { body: { invoiceIds, returnUrl } });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* keep generic message */ }
    throw new Error(msg);
  }
  if (!data?.url) throw new Error(data?.error ?? 'Payments are not set up yet.');
  if (Platform.OS === 'web') window.location.assign(data.url);
  else await WebBrowser.openBrowserAsync(data.url);
}
