-- A holding record and a digitised heritage record are different business
-- entities even though both use the books/artifacts tables.  Keep this scope
-- explicit so adding media to a library holding can never publish it in the
-- digital heritage catalogue.
ALTER TABLE "books"
  ADD COLUMN IF NOT EXISTS "is_digital_heritage" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "artifacts"
  ADD COLUMN IF NOT EXISTS "is_digital_heritage" BOOLEAN NOT NULL DEFAULT false;

-- These are the current records already curated through the digital catalogue
-- workflow before the explicit marker existed.  This deliberately uses a
-- reviewed, fixed list rather than media presence or source text as a future
-- publication rule.
UPDATE "books"
SET "is_digital_heritage" = true
WHERE "id" IN (
  'cmvj6p7m300f4lk7izs0yhjvo', 'cmth8wmgu000v68mcyn3mcb0p',
  'cmtv40nl900iwlk5qclliz3d7', 'cmv3fmdv9007olkn9k9bgurr0',
  'cmvgrg85j00pulkwde5esz1zu', 'cmudqrraf00ttlk6nwnwtxgqk',
  'cmth3zupr000k68mcevuecxb5', 'cmtgtrtft000068mce6chvyka',
  'cmuimfhtn01njlk6nwzqnev3j', 'cmufi7oem01gtlk6ni7avsw1x',
  'cmvp3o4zi00oxlkmphswr5re7', 'cmrrioa5q000f68a8v4vdqal5',
  'cmrsw00g3000768okkks4rkbh', 'cmt7ajxf50000686cyllkwvr2',
  'cmtziocb802d6lk5qets89001', 'cmujiyl6w01u1lk6n1aek1m7w',
  'cmvducxk500eglkwbii67pn5m', 'cmul6rz8w0033lk9jzsu738p1',
  'cmvfb0q3v00ialksyxhlblvqd', 'cmvni104d006wlkt9clmxa8jo',
  'cmuf2l2y9016zlk6ntfhm0vud', 'cmuuwxnic0033lku2a6uahqt2',
  'cmrtb9syl000j68so2iiagxs2', 'cmrsu7na6000268ok22s31qmc'
);

UPDATE "artifacts"
SET "is_digital_heritage" = true
WHERE "id" = 'cmrtdcz39000068tgp7oz6en2';
