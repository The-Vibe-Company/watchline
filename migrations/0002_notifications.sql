ALTER TABLE monitors ADD COLUMN webhook_url TEXT;
ALTER TABLE monitors ADD COLUMN notification_email TEXT;
ALTER TABLE monitors ADD COLUMN notify_events TEXT NOT NULL DEFAULT 'changed,down,recovered';

ALTER TABLE runs ADD COLUMN notification_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN notification_error TEXT;
