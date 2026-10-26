-- Idempotency ledger for bulk farmer imports. Only row numbers, status codes and
-- created farmer IDs are stored; names, phone numbers, IDs, images and OCR text
-- are never written here.

CREATE TABLE IF NOT EXISTS public.import_batches (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_key VARCHAR(120) NOT NULL,
  kind VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'processing',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, batch_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.import_batches
TO authenticated;

GRANT ALL
ON public.import_batches
TO service_role;

CREATE INDEX IF NOT EXISTS idx_import_batches_owner_created
ON public.import_batches (owner_user_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batches_kind_check') THEN
    ALTER TABLE public.import_batches
      ADD CONSTRAINT import_batches_kind_check CHECK (kind IN ('farmers', 'milk'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batches_status_check') THEN
    ALTER TABLE public.import_batches
      ADD CONSTRAINT import_batches_status_check CHECK (status IN ('processing', 'completed'));
  END IF;
END $$;
