import { FleetDashboard } from '../../components/FleetDashboard';
import { Loading } from '../../components/ui';
import { useAuth } from '../../lib/auth';

export default function Dashboard() {
  const { fleet } = useAuth();
  if (!fleet) return <Loading />;
  return <FleetDashboard fleetId={fleet.id} />;
}
