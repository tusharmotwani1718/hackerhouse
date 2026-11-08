-- Runs once, when the Postgres data volume is first created.
-- Separate database for tests (race test in step 3.4 onwards) so they never touch dev data.
CREATE DATABASE hacker_house_test;
