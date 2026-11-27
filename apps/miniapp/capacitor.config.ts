import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lumina.scanner',
  appName: 'Lumina 扫码',
  webDir: 'dist-apk',
  server: {
    androidScheme: 'https',
    allowNavigation: ['jianxing-asean-ai.com'],
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#ffffff',
  },
};

export default config;
