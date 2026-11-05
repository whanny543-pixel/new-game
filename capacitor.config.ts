import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.irondoctrine.game',
  appName: 'Iron Doctrine',
  webDir: 'dist',
  backgroundColor: '#10141a',
  ios: { contentInset: 'never' },
  android: { backgroundColor: '#10141a' },
};

export default config;
