ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE app_user
SET must_change_password = TRUE,
    updated_at = NOW()
WHERE username = 'admin'
  AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_active_token_expiry
  ON active_token(expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mfa_pending_expiry
  ON mfa_pending_token(expires_at)
  WHERE used_at IS NULL;
