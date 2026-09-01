-- Programme colours were regenerated twice and the stored rows followed neither, because
-- a programme's colour lives on the row rather than being computed from its position.
-- Anything off the current ten reads as "Custom" in the picker and can be handed out
-- again to a second programme, so both old sets are mapped onto their slot in the new one.
--
-- Two sets, because the two environments drifted apart: prod still holds the original
-- max-chroma ramp (L 0.68, chroma at the gamut edge), staging holds the flat-chroma one
-- that replaced it (L 0.76, C 0.112). Both map slot-for-slot onto the ramp shipping now
-- (L 0.76, chroma capped at 0.135 rather than flattened), so the hues a foundation picked
-- are preserved exactly — Amber stays Amber, it just stops being a mustard.
--
-- The three sets are disjoint, so nothing is remapped twice however this is replayed, and
-- a genuinely custom colour somebody chose by hand is left alone.
UPDATE "programmes"
SET "colour" = CASE "colour"
  WHEN '#f8518e' THEN '#f78baa'  -- Rose
  WHEN '#ec92ab' THEN '#f78baa'
  WHEN '#f8612d' THEN '#f99170'  -- Coral
  WHEN '#ee977c' THEN '#f99170'
  WHEN '#c88a24' THEN '#e4a341'  -- Amber
  WHEN '#dba65b' THEN '#e4a341'
  WHEN '#9e9f25' THEN '#b7b847'  -- Olive
  WHEN '#b5b75f' THEN '#b7b847'
  WHEN '#2ab646' THEN '#75c87c'  -- Green
  WHEN '#81c486' THEN '#75c87c'
  WHEN '#2baf9d' THEN '#33cbb7'  -- Teal
  WHEN '#4dc8b6' THEN '#33cbb7'
  WHEN '#2aa8c6' THEN '#32c4e6'  -- Sky
  WHEN '#4dc2e0' THEN '#32c4e6'
  WHEN '#4a9af7' THEN '#7cb5f9'  -- Blue
  WHEN '#7eb4f7' THEN '#7cb5f9'
  WHEN '#9982f7' THEN '#b0a3f9'  -- Violet
  WHEN '#b0a5f3' THEN '#b0a3f9'
  WHEN '#eb2ff5' THEN '#dd92df'  -- Magenta
  WHEN '#d698d7' THEN '#dd92df'
END
WHERE "colour" IN (
  '#f8518e', '#f8612d', '#c88a24', '#9e9f25', '#2ab646',
  '#2baf9d', '#2aa8c6', '#4a9af7', '#9982f7', '#eb2ff5',
  '#ec92ab', '#ee977c', '#dba65b', '#b5b75f', '#81c486',
  '#4dc8b6', '#4dc2e0', '#7eb4f7', '#b0a5f3', '#d698d7'
);
