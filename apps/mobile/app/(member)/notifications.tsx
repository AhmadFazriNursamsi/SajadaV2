import { NotificationList } from '../../src/NotificationList';
import { guardGroup } from '../../src/roleRoute';

function Notifications() {
  return <NotificationList />;
}

export default guardGroup('member', 'notifications', Notifications);
