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
    // NOTE: this nested ios.packageClassList is NOT what registers our custom
    // app-target plugins. The bridge's auto-registration reads only the
    // TOP-LEVEL packageClassList of the bundled capacitor.config.json, which
    // the CLI fills from npm plugin packages only. Our plugins are registered
    // in code via registerPluginInstance() in MainViewController.swift instead.
    // Left here as documentation of intent.
    packageClassList: ['HealthSyncPlugin', 'NativeAuthPlugin'],
  },
};

export default config;
