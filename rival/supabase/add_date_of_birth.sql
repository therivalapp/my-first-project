-- Sign-up now collects first/last name (combined into the existing
-- display_name column) and date of birth. handle_new_user's trigger only
-- ever inserts id/email/display_name from auth metadata, so DOB is written
-- separately by the client right after signUp() — this column just needs
-- to exist first.
alter table users add column if not exists date_of_birth date;
