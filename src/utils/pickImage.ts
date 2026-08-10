import {launchImageLibrary, type PhotoQuality} from 'react-native-image-picker';

/**
 * Open the device photo library and return the picked photo as a base64
 * data URI (`data:image/jpeg;base64,…`) so it can be stored in the app's
 * database (SQLite locally, Postgres in cloud mode) and rendered on any
 * device — unlike a `file://` URI, which only works on the phone that took
 * the photo.
 *
 * Returns `null` when the user cancels; throws on a real error.
 */
export async function pickImageFromGallery(opts?: {
  /** Downscale the long edge to at most this many px (default 1024). */
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
  // Fallback: no base64 payload — return the local URI (device-only).
  return asset.uri ?? null;
}
