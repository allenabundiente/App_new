import type {Product} from '../types';

/**
 * Find the product photo for a plan so the same picture shows up on every
 * screen. Returns undefined when there is no photo, and the screens then
 * show the placeholder icon instead.
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
