-- Deactivate old prelaunch questions (preserve vote history)
UPDATE prelaunch_questions SET active = false;

-- Insert new questions
INSERT INTO prelaunch_questions (slug, title_ar, title_en, description_ar, description_en, category, sort_order) VALUES
  ('israel-withdraw-lebanon-june',
   'هل ستنسحب إسرائيل من لبنان قبل ١ حزيران؟',
   'Will Israel Withdraw From Lebanon Before June 1?',
   NULL, NULL, 'politics', 1),
  ('parliamentary-elections-july-2027',
   'هل ستجري انتخابات نيابية قبل تموز ٢٠٢٧؟',
   'Will there be parliamentary elections before July 2027?',
   NULL, NULL, 'politics', 2),
  ('gold-5000-june-2026',
   'هل سيتجاوز سعر الذهب ٥٠٠٠$ قبل حزيران ٢٠٢٦؟',
   'Will the price of Gold surpass $5,000 before June 2026?',
   NULL, NULL, 'economy', 3),
  ('dollar-lbp-90k-summer',
   'هل سيبقى سعر الدولار تحت ٩٠,٠٠٠ ل.ل. حتى الصيف؟',
   'Will the dollar stay below 90,000 LBP through summer?',
   NULL, NULL, 'economy', 4),
  ('south-lebanon-reconstruction-2026',
   'هل سيبدأ إعمار الجنوب قبل نهاية ٢٠٢٦؟',
   'Will South Lebanon reconstruction begin before end of 2026?',
   NULL, NULL, 'politics', 5);
