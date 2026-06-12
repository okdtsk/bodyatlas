import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.okdtsk.bodyatlas',
  appName: 'BodyAtlas',
  webDir: 'app/dist/client', // required field; unused in remote mode but must exist for cap sync
  server: {
    url: 'https://bodyatlas.okdtsk.dev',
    allowNavigation: ['bodyatlas.okdtsk.dev', 'accounts.google.com', '*.google.com'],
  },
  ios: {
    contentInset: 'automatic',
    // Custom app-target plugins are NOT auto-discovered; they must be listed
    // here so the bridge registers them (ObjC class name, not jsName).
    packageClassList: ['HealthSyncPlugin'],
  },
};

export default config;
