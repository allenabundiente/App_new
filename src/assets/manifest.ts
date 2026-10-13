/**
 * Asset manifest - maps an icon name to a real image file.
 *
 * Every icon in the app is drawn with <AssetIcon name="..." />. Most names
 * already have a built-in SVG drawing (see components/AssetIcon.tsx) so the
 * app looks finished even without any image files. To use a real picture
 * instead, register it below.
 *
 * To add a real icon:
 *   1. Put the file in assets/icons/ (see assets/icons/README.md for the
 *      naming rules and the sizes that work best).
 *   2. Uncomment the matching `require` line below.
 *   3. Reload the app - every AssetIcon with that name now uses the picture.
 *
 * Naming: keep the keys in kebab-case and match the file name, e.g. key
 * "tab.home"  ->  assets/icons/tab.home.png
 */

export interface AssetRef {
  /** Actual file, e.g. require('../../assets/icons/tab.home.png'). */
  source: number;
}

const registry: Record<string, AssetRef> = {
  // App / brand
  // logo: {source: require('../../assets/icons/logo.png')},

  // Bottom tab bar / side rail
  // tab.home: {source: require('../../assets/icons/tab.home.png')},
  // tab.plans: {source: require('../../assets/icons/tab.plans.png')},
  // tab.customers: {source: require('../../assets/icons/tab.customers.png')},
  // tab.products: {source: require('../../assets/icons/tab.products.png')},
  // tab.requests: {source: require('../../assets/icons/tab.requests.png')},
  // tab.receipts: {source: require('../../assets/icons/tab.receipts.png')},
  // tab.users: {source: require('../../assets/icons/tab.users.png')},
  // tab.reports: {source: require('../../assets/icons/tab.reports.png')},

  // Header actions
  // bell: {source: require('../../assets/icons/bell.png')},
  // logout: {source: require('../../assets/icons/logout.png')},
  // back: {source: require('../../assets/icons/back.png')},
  // theme: {source: require('../../assets/icons/theme.png')},

  // Common actions
  // plus: {source: require('../../assets/icons/plus.png')},
  // check: {source: require('../../assets/icons/check.png')},
  // edit: {source: require('../../assets/icons/edit.png')},
  // trash: {source: require('../../assets/icons/trash.png')},
  // chat: {source: require('../../assets/icons/chat.png')},
  // money: {source: require('../../assets/icons/money.png')},
  // flag: {source: require('../../assets/icons/flag.png')},
  // calendar: {source: require('../../assets/icons/calendar.png')},
  // schedule: {source: require('../../assets/icons/schedule.png')},
  // card: {source: require('../../assets/icons/card.png')},

  // Generic product placeholder (used when a product has no icon of its own)
  // product: {source: require('../../assets/icons/product.png')},
};

/** Look up a key in the manifest. Returns null when there is no image. */
export function assetFor(name: string): number | null {
  return registry[name]?.source ?? null;
}
