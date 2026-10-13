import { useLocalSearchParams } from 'expo-router';
import { useAuth } from './auth';

/** The fleet a screen is about: ?fleet= (Admin viewing a customer) or the owner's own fleet. */
export function useFleetId(): string | null {
  const { fleet } = useLocalSearchParams<{ fleet?: string }>();
  const auth = useAuth();
  return fleet ?? auth.fleet?.id ?? null;
}
