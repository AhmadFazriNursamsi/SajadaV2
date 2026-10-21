import { NotificationList } from '../../src/NotificationList';
import { useShop } from '../../src/shopData';

export default function Notifications() {
  const shop = useShop();
  return <NotificationList products={shop.data?.products ?? []} />;
}
