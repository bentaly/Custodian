-- Programme colours move onto the ramp built from the four original Figma colours (Sky,
-- Blush, Amber, Violet): lightness now follows a curve through those four instead of
-- being one figure for all ten, which is what had turned the warm half to mustard.
--
-- A colour is stored on the row, so the ten presets that shipped in 0074 would otherwise
-- sit off-palette, read as "Custom" in the picker, and be handed out to a second
-- programme. Each maps to the preset NEAREST IN HUE on the new ramp (every one moves by
-- about a degree), so a programme keeps its colour identity: Sky stays Sky, and lands on
-- the exact original #37d1f7. The old Olive has no Olive to go to and becomes Lime, its
-- neighbour at the same hue.
--
-- Old and new sets are disjoint, so nothing is remapped twice however this is replayed,
-- and a colour somebody picked by hand is left alone. Staging's Wrenfield programmes were
-- re-assigned off the new ramp by hand before this ran and already hold new hexes.
UPDATE "programmes"
SET "colour" = CASE "colour"
  WHEN '#f78baa' THEN '#fba7bc'  -- Rose    → Blush
  WHEN '#f99170' THEN '#fbbda8'  -- Coral   → Coral
  WHEN '#e4a341' THEN '#fcc87f'  -- Amber   → Amber
  WHEN '#b7b847' THEN '#d4d873'  -- Olive   → Lime
  WHEN '#75c87c' THEN '#93e39b'  -- Green   → Green
  WHEN '#33cbb7' THEN '#4ae1cd'  -- Teal    → Teal
  WHEN '#32c4e6' THEN '#37d1f7'  -- Sky     → Sky
  WHEN '#7cb5f9' THEN '#519bf7'  -- Blue    → Blue
  WHEN '#b0a3f9' THEN '#9077ea'  -- Violet  → Violet
  WHEN '#dd92df' THEN '#d58cd5'  -- Magenta → Magenta
END
WHERE "colour" IN (
  '#f78baa', '#f99170', '#e4a341', '#b7b847', '#75c87c',
  '#33cbb7', '#32c4e6', '#7cb5f9', '#b0a3f9', '#dd92df'
);
