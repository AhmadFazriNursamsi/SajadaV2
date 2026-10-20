import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from './theme';

/** Koin emas bergambar bintang. */
export function CoinIcon({ size = 20 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.gold, borderWidth: 1.5, borderColor: '#e3bf6a', alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="star" size={size * 0.58} color={C.goldInk} />
    </View>
  );
}
