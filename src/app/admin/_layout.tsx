import { Redirect, Tabs } from 'expo-router';
import { tabIcon as icon } from '../../components/TabIcon';
import { Loading } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { C } from '../../lib/theme';

export default function AdminTabs() {
  const { loading, session, isAdmin } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Redirect href="/auth/sign-in" />;
  if (!isAdmin) return <Redirect href="/" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: C.amber, tabBarInactiveTintColor: '#A9B0BA',
      tabBarStyle: { backgroundColor: C.nav, borderTopColor: C.line }, sceneStyle: { backgroundColor: C.bg } }}>
      <Tabs.Screen name="index" options={{ title: 'Overview', tabBarIcon: icon('speedometer-outline') }} />
      <Tabs.Screen name="customers" options={{ title: 'Customers', tabBarIcon: icon('business-outline') }} />
      <Tabs.Screen name="work" options={{ title: 'Work', tabBarIcon: icon('construct-outline') }} />
      <Tabs.Screen name="money" options={{ title: 'Money', tabBarIcon: icon('cash-outline') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('settings-outline') }} />
    </Tabs>
  );
}
