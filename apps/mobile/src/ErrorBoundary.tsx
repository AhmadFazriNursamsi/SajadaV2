import { Component, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { C } from './theme';
import { Button } from './ui';

/** Galat render tidak lagi menutup aplikasi: tampil pesan + tombol coba lagi. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: C.bg }}>
        <Text style={{ fontSize: 20, fontWeight: '600', color: C.green }}>Terjadi kesalahan</Text>
        <Text style={{ color: C.muted }}>Maaf, layar ini gagal dimuat. Data Anda aman. Silakan coba lagi.</Text>
        <Button label="Coba lagi" onPress={() => this.setState({ failed: false })} />
      </View>
    );
  }
}
