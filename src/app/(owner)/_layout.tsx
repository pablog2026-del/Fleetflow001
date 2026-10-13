import { Redirect, Tabs } from 'expo-router';
import { tabIcon as icon } from '../../components/TabIcon';
import { Loading } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { C } from '../../lib/theme';

export default function OwnerTabs() {
  const { loading, session, fleet } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Redirect href="/auth/sign-in" />;
  if (!fleet) return <Redirect href="/" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: C.amber, tabBarInactiveTintColor: '#A9B0BA',
      tabBarStyle: { backgroundColor: C.nav, borderTopColor: C.line }, sceneStyle: { backgroundColor: C.bg } }}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="activities" options={{ title: 'Repairs', tabBarIcon: icon('construct-outline') }} />
      <Tabs.Screen name="accounting" options={{ title: 'Accounting', tabBarIcon: icon('receipt-outline') }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports', tabBarIcon: icon('bar-chart-outline') }} />
      <Tabs.Screen name="request" options={{ title: 'Request', tabBarIcon: icon('add-circle-outline') }} />
    </Tabs>
  );
}
