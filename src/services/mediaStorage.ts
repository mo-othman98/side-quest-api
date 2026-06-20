import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

export function isCloudinaryConfigured(): boolean {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function ensureCloudinaryConfigured(): void {
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary is not configured');
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export async function uploadLocalFile(
  localPath: string,
  folder: 'completions' | 'avatars'
): Promise<string> {
  ensureCloudinaryConfigured();

  try {
    const result = await cloudinary.uploader.upload(localPath, {
      folder: `side-quest/${folder}`,
      resource_type: 'auto',
    });
    return result.secure_url;
  } finally {
    fs.unlink(localPath, () => undefined);
  }
}

export async function deleteCloudinaryAsset(url: string | null | undefined): Promise<void> {
  if (!url || !isCloudinaryConfigured() || !url.includes('res.cloudinary.com')) {
    return;
  }

  ensureCloudinaryConfigured();

  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[^/]+$/);
  if (!match?.[1]) return;

  const publicId = match[1];
  await cloudinary.uploader.destroy(publicId, { resource_type: 'image' }).catch(() => undefined);
}
