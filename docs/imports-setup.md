# Bulk farmer and milk notebook imports

## What is supported

- Farmer lists: pasted text, CSV/TXT, Excel (`.xlsx`/`.xls`), text PDFs, and list photos.
- Milk notebooks: pasted text, a notebook photo, or a list photo.
- Limits: 1,000 parsed file rows, 500 farmer rows per save request, 100 milk rows per
  save request, and 8 MB for CSV/Excel/PDF uploads. The browser saves in chunks of 50.
- The committed rows use the normal farmer/milk services, so authorization, center
  ownership, session rules, configured prices, price snapshots, and audit logging all
  still apply.

## OCR configuration

Photo scanning uses Google Cloud Vision `DOCUMENT_TEXT_DETECTION`. It is optional.
Without credentials, the UI disables scanning and clearly reports that the server is
not configured; paste, CSV, Excel, and text PDF imports still work.

Configure **one** of these server-only environment variables:

| Variable | Use |
| --- | --- |
| `GOOGLE_VISION_API_KEY` | Google Cloud API key restricted to Cloud Vision. |
| `GOOGLE_VISION_SERVICE_ACCOUNT_JSON` | Full service-account JSON as one environment value. |
| `GOOGLE_VISION_SERVICE_ACCOUNT_BASE64` | Base64-encoded service-account JSON. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Filesystem path to a service-account JSON file visible to the server process. |

The service account needs permission to call the Cloud Vision API. Do not prefix any
of these variables with `NEXT_PUBLIC_`; that would expose credentials to the browser.
The API key alternative uses the `X-Goog-Api-Key` header, and the service-account
alternative obtains a short-lived OAuth token on the server.

`GET /api/imports/ocr` reports only whether OCR is configured and the names of the
missing setup variables. It never returns credential values.

## Privacy and temporary data

- Source files and images are kept in request/response memory only.
- No source document, image, OCR text, name, phone number, or row payload is written to
  the database, logs, analytics, `localStorage`, `sessionStorage`, or IndexedDB.
- Import batches store only row numbers, status/error codes/messages, and created farmer
  IDs. Source documents are never attached.
- Browser preview object URLs are revoked when replaced, reset, or when the modal closes.
- A page refresh discards the uncommitted review. This is intentional.

## Database migration

`supabase/migrations/019_import_batches.sql` adds the idempotency ledger used by farmer
batch saves. Apply it through the normal approved migration process before using the
farmer import. The public health check includes migration `019`. Milk notebook imports
do not add a table; they rely on the existing strict milk insert behavior.

## Verification

```bash
npx tsc --noEmit
npm test
npm run build
```

Do not run database-writing integration tests without a disposable database.
