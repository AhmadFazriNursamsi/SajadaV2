import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSession } from '../src/session';

export default function Index() {
  const { me, ready } = useSession();
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  if (!me) return <Redirect href="/login" />;
  if (me.mustChangePassword) return <Redirect href="/ganti-sandi" />;
  return <Redirect href={me.role === 'member' ? '/(member)' : '/(staff)'} />;
}
