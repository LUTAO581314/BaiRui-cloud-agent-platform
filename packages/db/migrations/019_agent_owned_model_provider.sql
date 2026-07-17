ALTER TABLE model_policies
  ALTER COLUMN user_custom_keys_allowed SET DEFAULT true;

UPDATE model_policies
SET user_custom_keys_allowed = true,
    updated_at = now()
WHERE user_custom_keys_allowed = false;
