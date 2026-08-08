# In-app icons — what to create

The app renders every icon through a semantic key system
(`<AssetIcon name="..." />`, manifest in `src/assets/manifest.ts`). Until a
key has a real file, the app shows a **placeholder tile** — the layout is
complete, the artwork just isn't there yet.

**To add an icon:**
1. Drop the file here with the exact name from the table below.
2. Uncomment the matching line in `src/assets/manifest.ts`.
3. Reload the app.

---

## Naming rules

- Files are named after their semantic key, e.g. key `tab.home` →
  `tab.home.png`.
- **PNG with transparency**, 2× or 3× density recommended. A single
  128×128px PNG works everywhere the app scales it (tiles are rendered at
  16–64px, so 128px keeps them crisp on high-density screens).
- Use a consistent **stroke style**: 2px strokes, rounded caps, filled or
  outline as you prefer — just keep one style across the whole set so the
  UI looks like one family.
- Make everything look right on **both dark and light themes** — prefer a
  color that reads on `#151d36` (dark) and `#ffffff` (light), or ship a
  light-variant when the icon is tint-dependent (optional; see below).

---

## The checklist

### Brand (1 file)
| Key / file | Used for | Notes |
|---|---|---|
| `logo.png` | Login screen mark, splash | Your shop/logotype mark. 256×256. |

### Bottom tab bar — sellers (5 files)
| Key / file | Tab |
|---|---|
| `tab.home.png` | Home |
| `tab.plans.png` | Installment Plans |
| `tab.products.png` | Products |
| `tab.customers.png` | Customers |
| `tab.requests.png` | Adjustment Requests |

### Bottom tab bar — buyers (3 files)
| Key / file | Tab |
|---|---|
| `tab.home.png` | Home (shared) |
| `tab.plans.png` | My Plans (shared) |
| `tab.receipts.png` | Receipts |

### Bottom tab bar — admins (3 files)
| Key / file | Tab |
|---|---|
| `tab.home.png` | Home (shared) |
| `tab.users.png` | Users |
| `tab.reports.png` | Reports |

### Header + navigation (4 files)
| Key / file | Used for |
|---|---|
| `bell.png` | Notification bell (with unread dot) |
| `logout.png` | Sign out |
| `back.png` | Back button |
| `theme.png` | Light/dark toggle |

### Common actions (9 files)
| Key / file | Used for |
|---|---|
| `plus.png` | “Add product”, “Add customer”, “New plan” |
| `check.png` | Paid states, “all caught up” |
| `edit.png` | Edit actions |
| `trash.png` | Delete actions |
| `money.png` | Payments, money rows |
| `flag.png` | Early settlement / finish |
| `calendar.png` | Due dates |
| `schedule.png` | Payment schedule |
| `chat.png` | Plan chat |
| `card.png` | Receipts / payment methods |
| `product.png` | Generic product fallback tile |

### Product images (optional, high value)
Products can get their own artwork later — e.g. `products/phone.png`,
`products/tv.png`. Wire them through `ProductIcon`-style mapping in
`src/assets/manifest.ts` keyed by product name/category.

---

## Sizes / formats cheat sheet

| Use | Size | Format |
|---|---|---|
| Tab bar + header buttons | 64–128px | PNG, transparent bg |
| List-row tiles (44px shown) | 64–128px | PNG, transparent bg |
| Buttons (16–18px shown) | 32–64px | PNG, transparent bg |
| Logo mark | 256px | PNG or SVG master |
| Empty-state tiles (64px shown) | 128px | PNG, transparent bg |

## Dark / light variants (optional)
If an icon needs different colors per theme, add `-light` / `-dark`
suffixes (`tab.home-light.png`) and extend the manifest resolver — the
`AssetIcon` component already knows the active theme.

## File size & format rules
- **PNG only** for icons. No JPG (no transparency).
- Keep an **SVG master** per icon if you plan to iterate: the generator
  script in `tools/generate-branding.mjs` can rasterize a folder of SVGs.
- Prefer simple single-color or 2-color marks — they stay legible at 16px.
