export interface UpdateManifest {
  schemaVersion: number; layer: string; version: string; channel: string; publishedAt: string;
  files: { path: string; size: number; sha256: string }[];
  signature: { algorithm: string; keyId: string; value: string };
  [key: string]: unknown;
}
export function verifyManifest(manifest: UpdateManifest, keys: Record<string, string>, options?: object): UpdateManifest;
export function sha256(bytes: Buffer): string;
export function compareVersions(a: string, b: string): number;
