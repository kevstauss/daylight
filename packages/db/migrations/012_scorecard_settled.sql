-- Did this scan's capture finish loading before the page was inventoried?
--
-- Floodlight diffs each scan against the previous scorecard. Without this the previous side could
-- not say whether it had seen the whole page, so a complete scan compared against a partial
-- baseline published the difference as the site adding trackers. NULL = unknown, which withholds
-- the comparison rather than guessing.
ALTER TABLE scorecards ADD COLUMN settled INTEGER;
