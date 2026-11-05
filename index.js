/**
 * @format
 */

import {AppRegistry} from 'react-native';
import notifee, {EventType} from '@notifee/react-native';
import App from './App';
import {name as appName} from './app.json';
import {rememberNotificationPress} from './src/services/notificationPress';

// A press can arrive while the app is killed. Store the target now; the
// navigation shell consumes it after the saved session has loaded.
notifee.onBackgroundEvent(async ({type, detail}) => {
  if (type === EventType.PRESS) {
    rememberNotificationPress(detail.notification);
  }
});

AppRegistry.registerComponent(appName, () => App);
