import { NotificationInstancesController, NotificationsController } from '../../notifications/notifications.controller';
import { defineModule } from '../module-descriptor';

/**
 * ST-NOT-001: the in-app inbox and the notification metadata reads. The worked example of a module descriptor; the
 * implementation stays in apps/api/src/notifications, a new slice puts its code in apps/api/src/modules/<code>/.
 */
export const notificationsModule = defineModule({
  code: 'NOT',
  controllers: [NotificationsController, NotificationInstancesController],
});
