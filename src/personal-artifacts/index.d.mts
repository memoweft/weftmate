export const MAX_ARTIFACT_BYTES: number;

export function artifactContentType(fileName: string): string;
export function validArtifactFileName(fileName: unknown): fileName is string;

export interface PersonalArtifactBytes {
  bytes: Buffer;
  size: number;
  sha256: string;
}

export interface PersonalTextArtifact extends PersonalArtifactBytes {
  fileName: string;
  contentType: string;
}

export function canonicalArtifact(fileName: unknown, content: unknown): PersonalTextArtifact;
export function createPersonalArtifactStore(root: string): {
  inspect(ownerId: string, taskId: string, artifactId: string,
    expected: Pick<PersonalArtifactBytes, 'size' | 'sha256'>): Promise<Buffer>;
  write(ownerId: string, taskId: string, artifactId: string, artifact: PersonalArtifactBytes): Promise<void>;
};
