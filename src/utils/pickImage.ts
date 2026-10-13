import {launchImageLibrary, type PhotoQuality} from 'react-native-image-picker';

/**
 * Opens the phone's photo gallery and returns the picture as a base64 data
 * URI so it can be saved in the database. We can't use a normal file:// path
 * because that only works on the phone the photo was taken on.
 *
 * Returns null if the user cancels.
 */
export async function pickImageFromGallery(opts?: {
  /** Shrink the picture so it isn't too big to store (default 1024px). */
  maxWidth?: number;
  quality?: PhotoQuality;
}): Promise<string | null> {
  const result = await launchImageLibrary({
    mediaType: 'photo',
    includeBase64: true,
    maxWidth: opts?.maxWidth ?? 1024,
    maxHeight: opts?.maxWidth ?? 1024,
    quality: opts?.quality ?? 0.6,
    selectionLimit: 1,
  });
  if (result.didCancel) {
    return null;
  }
  if (result.errorCode) {
    throw new Error(
      result.errorMessage ?? `Could not open the photo library (${result.errorCode}).`,
    );
  }
  const asset = result.assets?.[0];
  if (!asset) {
    return null;
  }
  if (asset.base64) {
    const mime = asset.type ?? 'image/jpeg';
    return `data:${mime};base64,${asset.base64}`;
  }
  // No base64 data came back, so just use the local file path.
  return asset.uri ?? null;
}
