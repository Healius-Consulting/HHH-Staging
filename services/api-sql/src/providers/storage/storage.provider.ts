import { Storage } from '@google-cloud/storage';
import { config } from '../../bootstrap/config.js';

export interface SignedUploadTarget {
  id: string;
  storagePath: string;
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
}

export class StorageProvider {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor() {
    this.storage = new Storage({ projectId: config.FIREBASE_PROJECT_ID });
    this.bucketName = `${config.FIREBASE_PROJECT_ID}.firebasestorage.app`;
  }

  async generateUploadTarget(params: {
    organisationId: string;
    fileId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds?: number;
  }): Promise<SignedUploadTarget> {
    const { organisationId, fileId, filename, contentType, expiresInSeconds = 900 } = params;
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `prescriptions/${organisationId}/${fileId}/${sanitizedFilename}`;

    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(storagePath);

    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + expiresInSeconds * 1000,
      contentType,
    });

    return {
      id: fileId,
      storagePath,
      uploadUrl,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      requiredHeaders: {
        'Content-Type': contentType,
      },
    };
  }

  async generateDownloadUrl(storagePath: string, expiresInSeconds = 300): Promise<string> {
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(storagePath);

    const [downloadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresInSeconds * 1000,
    });

    return downloadUrl;
  }

  async deleteFile(storagePath: string): Promise<void> {
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const file = bucket.file(storagePath);
      await file.delete({ ignoreNotFound: true });
    } catch (error) {
      console.warn(`Storage delete failed for ${storagePath}:`, error);
    }
  }

  async downloadFile(storagePath: string): Promise<{ bytes: Buffer; contentType: string | null }> {
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`Prescription file is not in storage (${storagePath}).`);
    }
    const [bytes] = await file.download();
    const [metadata] = await file.getMetadata();
    return {
      bytes,
      contentType: typeof metadata.contentType === 'string' ? metadata.contentType : null,
    };
  }
}
