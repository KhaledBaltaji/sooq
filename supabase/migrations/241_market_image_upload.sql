-- 241_market_image_upload.sql — Market image upload support
--
-- Creates public storage bucket for market images and adds p_image_url
-- parameter to admin_create_market and admin_update_market RPCs.

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. Supabase Storage bucket for market images (PUBLIC)
-- ══════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'market-images',
  'market-images',
  true,       -- public bucket: market images are shown to all users
  5242880,    -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Admins can upload market images
CREATE POLICY "Admins upload market images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'market-images'
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Admins can update/replace market images
CREATE POLICY "Admins update market images"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'market-images'
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Admins can delete market images
CREATE POLICY "Admins delete market images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'market-images'
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Anyone can view market images (public bucket)
CREATE POLICY "Public read market images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'market-images');


-- ══════════════════════════════════════════════════════════════
-- 2. admin_create_market — add p_image_url parameter
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_create_market(
  p_question_en TEXT,
  p_question_ar TEXT,
  p_description_en TEXT DEFAULT NULL,
  p_description_ar TEXT DEFAULT NULL,
  p_category TEXT DEFAULT 'politics',
  p_keywords TEXT[] DEFAULT '{}',
  p_liquidity_param DECIMAL DEFAULT NULL,
  p_opens_at TIMESTAMPTZ DEFAULT now(),
  p_closes_at TIMESTAMPTZ DEFAULT now() + interval '7 days',
  p_image_url TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID;
  v_market_id UUID;
  v_b DECIMAL;
  v_yes_price DECIMAL;
  v_no_price DECIMAL;
BEGIN
  -- 1. Verify admin
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- 2. Validate inputs
  IF p_question_en IS NULL OR length(trim(p_question_en)) = 0 THEN
    RAISE EXCEPTION 'English question is required';
  END IF;
  IF p_question_ar IS NULL OR length(trim(p_question_ar)) = 0 THEN
    RAISE EXCEPTION 'Arabic question is required';
  END IF;
  IF p_closes_at <= p_opens_at THEN
    RAISE EXCEPTION 'Close date must be after open date';
  END IF;

  -- 3. Determine liquidity parameter
  IF p_liquidity_param IS NULL THEN
    SELECT rate INTO v_b FROM fee_config WHERE fee_type = 'amm_default_b' LIMIT 1;
    v_b := COALESCE(v_b, 1000);
  ELSE
    v_b := p_liquidity_param;
  END IF;

  IF v_b <= 0 THEN
    RAISE EXCEPTION 'Liquidity parameter must be positive';
  END IF;

  -- 4. Insert market
  INSERT INTO markets (question_en, question_ar, description_en, description_ar,
                       category, keywords, amm_liquidity_param, opens_at, closes_at,
                       created_by, status, image_url)
  VALUES (p_question_en, p_question_ar, p_description_en, p_description_ar,
          p_category, p_keywords, v_b, p_opens_at, p_closes_at,
          v_admin_id, 'open', p_image_url)
  RETURNING id INTO v_market_id;

  -- 5. Initialize AMM (inline, same logic as initialize_amm)
  v_yes_price := lmsr_price(v_b, 0, 0, 'yes');
  v_no_price := lmsr_price(v_b, 0, 0, 'no');

  INSERT INTO amm_state (market_id, liquidity_param, q_yes, q_no, current_yes_price, current_no_price)
  VALUES (v_market_id, v_b, 0, 0, v_yes_price, v_no_price);

  -- 6. Audit log
  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/create_market', format('Market created: %s', left(p_question_en, 80)),
    jsonb_build_object(
      'admin_id', v_admin_id,
      'market_id', v_market_id,
      'category', p_category,
      'liquidity_param', v_b,
      'opens_at', p_opens_at,
      'closes_at', p_closes_at,
      'image_url', p_image_url IS NOT NULL
    ));

  RETURN jsonb_build_object(
    'success', true,
    'market_id', v_market_id,
    'liquidity_param', v_b,
    'yes_price', ROUND(v_yes_price, 6),
    'no_price', ROUND(v_no_price, 6)
  );
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- 3. admin_update_market — add p_image_url parameter
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_update_market(
  p_market_id UUID,
  p_description_en TEXT DEFAULT NULL,
  p_description_ar TEXT DEFAULT NULL,
  p_closes_at TIMESTAMPTZ DEFAULT NULL,
  p_keywords TEXT[] DEFAULT NULL,
  p_image_url TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID;
  v_market RECORD;
BEGIN
  -- 1. Verify admin
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- 2. Validate market
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status IN ('resolved', 'voided') THEN
    RAISE EXCEPTION 'Cannot edit a % market', v_market.status;
  END IF;

  -- 3. Validate closes_at if provided
  IF p_closes_at IS NOT NULL AND p_closes_at <= v_market.opens_at THEN
    RAISE EXCEPTION 'Close date must be after open date';
  END IF;

  -- 4. Update only provided fields
  UPDATE markets SET
    description_en = COALESCE(p_description_en, description_en),
    description_ar = COALESCE(p_description_ar, description_ar),
    closes_at = COALESCE(p_closes_at, closes_at),
    keywords = COALESCE(p_keywords, keywords),
    image_url = COALESCE(p_image_url, image_url)
  WHERE id = p_market_id;

  -- 5. Audit log
  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/update_market', format('Market updated: %s', left(v_market.question_en, 80)),
    jsonb_build_object(
      'admin_id', v_admin_id,
      'market_id', p_market_id,
      'updated_fields', jsonb_build_object(
        'description_en', p_description_en IS NOT NULL,
        'description_ar', p_description_ar IS NOT NULL,
        'closes_at', p_closes_at IS NOT NULL,
        'keywords', p_keywords IS NOT NULL,
        'image_url', p_image_url IS NOT NULL
      )
    ));

  RETURN jsonb_build_object(
    'success', true,
    'market_id', p_market_id
  );
END;
$$;

COMMIT;
