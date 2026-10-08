import type { UpdateManifest } from './manifest.mjs';
export function readAppUpdateManifest(feed: string, appVersion: string, channel?: string): Promise<UpdateManifest>;
export function verifyDownloadedApp(manifest: UpdateManifest, file: string): Promise<void>;
