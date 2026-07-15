-- Which measurement privacy_text_hash actually holds: the notice's fetched TEXT, or just its URL.
--
-- The capture hashes the privacy URL, then upgrades to a hash of the policy text when it can
-- fetch it — and that fetch fails on exactly the bot-protected hosts we watch. So one unchanged
-- page flipped between two unrelated hashes and published "privacy notice text changed" 38 times.
-- A hash is only comparable to a hash of the same thing; NULL means unknown and blocks the
-- comparison rather than guessing.
ALTER TABLE snapshots ADD COLUMN privacy_hash_kind TEXT;
