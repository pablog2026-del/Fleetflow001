// Admin: the owner's dashboard for any customer (read-only fleet view).
import { useLocalSearchParams } from 'expo-router';
import { FleetDashboard } from '../../components/FleetDashboard';

export default function AdminFleetView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FleetDashboard fleetId={id} adminView />;
}
