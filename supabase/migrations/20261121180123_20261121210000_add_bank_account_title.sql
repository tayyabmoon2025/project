/*
# Add a bank account title to the school payment details

## 1. What this changes
The payment details the school prints on every fee challan now hold a title for the bank
account as well as its number, so families can confirm who they are paying.

## 2. Modified table: `school_payment_settings`
- New column `bank_account_name` (text, not null, default empty) — the name the bank
  account is held in, printed under "Bank transfer" on the challan beside the bank name
  and the account / IBAN number. It is separate from `easypaisa_account_name`; the two
  are never copied into one another.

## 3. Security
- No policy, grant or function changes. The existing rules still apply: staff and signed-in
  family members may read these details, and only an administrator may change them.

## 4. Notes
- The column is added with IF NOT EXISTS, so re-running this migration is safe.
- Existing rows keep their current values and simply show an empty title until an
  administrator fills it in.
*/

ALTER TABLE public.school_payment_settings
  ADD COLUMN IF NOT EXISTS bank_account_name text NOT NULL DEFAULT '';
