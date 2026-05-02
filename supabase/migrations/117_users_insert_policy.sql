-- Allow authenticated users to create their own profile row (needed for OAuth signup)
CREATE POLICY "Users can create own profile"
  ON users FOR INSERT
  WITH CHECK (auth.uid() = id);
