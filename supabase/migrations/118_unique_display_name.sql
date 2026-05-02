-- Case-insensitive unique constraint on display_name (NULL allowed for incomplete profiles)
CREATE UNIQUE INDEX idx_users_display_name_unique
  ON users (LOWER(display_name))
  WHERE display_name IS NOT NULL;
