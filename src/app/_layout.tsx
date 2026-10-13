import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../lib/auth';
import { C } from '../lib/theme';

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: C.bg, card: C.nav, text: C.text, primary: C.amber, border: C.line } };

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerStyle: { backgroundColor: C.nav }, headerTintColor: C.text, contentStyle: { backgroundColor: C.bg }, headerBackTitle: 'Back' }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(owner)" options={{ headerShown: false }} />
            <Stack.Screen name="admin" options={{ headerShown: false }} />
            <Stack.Screen name="auth/sign-in" options={{ headerShown: false }} />
            <Stack.Screen name="auth/sign-up" options={{ title: 'Create account' }} />
            <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
            <Stack.Screen name="auth/set-password" options={{ title: 'Set your password' }} />
            <Stack.Screen name="onboarding" options={{ title: 'Your company' }} />
            <Stack.Screen name="unit/[id]" options={{ title: 'Unit detail' }} />
            <Stack.Screen name="activity/[id]" options={{ title: 'Repair activity' }} />
            <Stack.Screen name="interval/[id]" options={{ title: 'OEM schedule item' }} />
            <Stack.Screen name="invoice/[id]" options={{ title: 'Invoice' }} />
            <Stack.Screen name="profile" options={{ title: 'Customer profile' }} />
            <Stack.Screen name="history" options={{ title: 'Repair history' }} />
            <Stack.Screen name="breakdown" options={{ title: 'Breakdown' }} />
            <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
            <Stack.Screen name="add-truck" options={{ title: 'Add truck' }} />
            <Stack.Screen name="estimate/[id]" options={{ title: 'Send estimate' }} />
            <Stack.Screen name="customer/[id]" options={{ title: 'Customer' }} />
            <Stack.Screen name="new-customer" options={{ title: 'Add customer' }} />
            <Stack.Screen name="review/[fleet]" options={{ title: 'Review OEM schedules' }} />
            <Stack.Screen name="fleet/[id]" options={{ title: 'Fleet view' }} />
            <Stack.Screen name="security" options={{ title: 'Security' }} />
          </Stack>
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
