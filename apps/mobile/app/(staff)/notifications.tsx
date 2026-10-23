import { NotificationList } from '../../src/NotificationList';
import { guardGroup } from '../../src/roleRoute';

function StaffNotifications() {
  return <NotificationList />;
}

export default guardGroup('staff', 'notifications', StaffNotifications);
