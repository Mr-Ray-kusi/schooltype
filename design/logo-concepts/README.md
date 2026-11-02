# Logo concepts

Three directions explored for the Schooltype mark, kept as a record of what was
considered and rejected. `concepts.png` shows all three at full size and at 40 / 24 / 16px.

| File | Concept | Outcome |
| --- | --- | --- |
| `a-scan-cap.svg` | Mortarboard inside scanner viewfinder brackets | Not chosen — reads as a cap in a frame, collapses at favicon size |
| `b-qr-mortarboard.svg` | Mortarboard board built from a QR module grid | **Chosen** |
| `c-id-card.svg` | The student QR ID card | Not chosen — too much detail to survive 16px |

B won on three counts: it is the only silhouette nobody else in this space owns, it stays
legible as a favicon, and it carries the product meaning — QR-scanned student identity is
what attendance, fees, and the public ID lookup are all built on.

The shipped assets live in `frontend/public/`:

- `logo.svg` — tiled blue mark, used as favicon and PWA icon
- `logo-mono.svg` — one colour, no tile, takes `currentColor`
- `logo-lockup.svg` — horizontal mark plus wordmark, for email and social
- `logo-192.png`, `logo-512.png`, `apple-touch-icon.png` — raster sizes, regenerate from `logo.svg` if the mark changes

In the app the mark is drawn inline by `src/components/BrandLogo.jsx` so it can inherit the
surrounding colour; the marketing header and footer render it in brass on forest.
