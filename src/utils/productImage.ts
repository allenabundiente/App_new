import type {Product} from '../types';

/**
 * Resolve the photo for the product behind a plan, so the same image shows
 * on every page where the product appears (matching the web preview).
 * Falls back to `undefined` → screens render the placeholder icon tile.
 */
export function productImageFor(
  products: Product[],
  plan: {productId: string | null},
): string | undefined {
  if (!plan.productId) {
    return undefined;
  }
  const image = products.find(p => p.id === plan.productId)?.image;
  return image ? image : undefined;
}
