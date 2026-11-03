ALTER TABLE subscription_email_events
  ALTER COLUMN subscription_id DROP NOT NULL;

ALTER TABLE subscription_email_events
  DROP CONSTRAINT IF EXISTS subscription_email_events_event_type_check;

ALTER TABLE subscription_email_events
  ADD CONSTRAINT subscription_email_events_event_type_check
  CHECK (event_type IN (
    'payment_confirmation',
    'payment_status',
    'subscription_reminder',
    'subscription_expired',
    'subscription_usage_exceeded',
    'business_event'
  ));