-- gen_uuidv7(), v2: ids are now strictly increasing per connection, like Postgres 18's built-in
-- uuidv7(). Replaces v1 (first migration), whose ids from the same millisecond came out in random
-- order. That broke a promise the schema relies on: every row of one transaction has the same
-- created_at (transaction_timestamp()), so (created_at, id) orders e.g. a team's audit history
-- only if the ids follow insertion order ("MEMBER_LEFT" then "TEAM_DELETED", never the reverse).
--
-- Layout (RFC 9562): 48 bits Unix ms | version 7 | 12 bits sub-ms | variant | 62 random bits.
--  * The 12 bits are the fraction of the millisecond (1 tick = 1/4096 ms, ~244 ns; RFC 9562
--    §6.2 method 3), so ids are ordered by time even within one millisecond.
--  * The last tick this connection used is kept in a session setting. A tick not greater than
--    it (several rows in one INSERT, or the clock stepping back) becomes last + 1 (method 3 +
--    a counter, as Postgres 18 does). Uniqueness still comes from the 62 random bits.
--  * Session, not transaction: with a transaction-mode pooler (Supabase), the next client on the
--    same server connection also only gets bigger ids. A rolled-back transaction rolls the
--    setting back too, which is fine: its ids never became rows.
-- PARALLEL UNSAFE: set_config() is not allowed in parallel workers (defaults only run in
-- INSERTs, which never run in parallel anyway).
CREATE OR REPLACE FUNCTION gen_uuidv7() RETURNS uuid
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE AS $$
DECLARE
  tick bigint := floor(extract(epoch FROM clock_timestamp()) * 1000 * 4096)::bigint;
  last_tick bigint := nullif(current_setting('gen_uuidv7.last_tick', true), '')::bigint;
BEGIN
  IF tick <= last_tick THEN
    tick := last_tick + 1;
  END IF;
  PERFORM set_config('gen_uuidv7.last_tick', tick::text, false);
  -- First 8 bytes: ms << 16 | 7 << 12 | sub-ms. Bytes 9–16 (variant + random) stay from v4.
  RETURN encode(
    overlay(
      uuid_send(gen_random_uuid())
      PLACING int8send(((tick >> 12) << 16) | (7 << 12) | (tick & 4095))
      FROM 1 FOR 8
    ),
    'hex'
  )::uuid;
END
$$;
