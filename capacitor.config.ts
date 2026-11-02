import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.outpostrush.game',
  appName: 'Outpost Rush',
  webDir: 'dist',
  backgroundColor: '#1b1030',
  ios: { contentInset: 'never' },
  android: { backgroundColor: '#1b1030' },
};

export default config;
