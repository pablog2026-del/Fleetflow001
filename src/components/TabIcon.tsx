import { Ionicons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';

export const tabIcon = (name: keyof typeof Ionicons.glyphMap) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;
