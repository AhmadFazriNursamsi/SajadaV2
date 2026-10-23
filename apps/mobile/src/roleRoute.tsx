import type { ComponentType } from 'react';
import { Redirect } from 'expo-router';
import { useSession } from './session';

/**
 * Layar anggota dan petugas berbagi alamat yang sama (/orders, /profile, /notifications) karena nama grup folder tidak ikut ke URL.
 * Saat alamat dibuka langsung (mis. muat ulang di browser), grup pertama yang cocok dipakai walau akunnya bukan miliknya
 * ("Akun tidak terhubung ke anggota"). Pembungkus ini memindahkan pengguna ke layar yang sepadan di grup yang benar
 * sebelum layar memuat data.
 */
export function guardGroup(group: 'member' | 'staff', screen: 'orders' | 'profile' | 'notifications', Screen: ComponentType): ComponentType {
  const other = group === 'member' ? 'staff' : 'member';
  return function RoleGuard() {
    const { me } = useSession();
    if (me && (me.role === 'member') !== (group === 'member')) return <Redirect href={`/(${other})/${screen}` as never} />;
    return <Screen />;
  };
}
