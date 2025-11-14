# Supabase Migrations Guide

## Migration 001: Initial Schema Setup

**File:** `supabase-setup.sql`

**Description:**
Creates the initial database schema including:
- `deployments` table with all required columns and indexes
- `monitor_state` table for tracking last checked block
- Automatic timestamp triggers
- Row Level Security policies

**To Run:**
1. Open your Supabase Dashboard
2. Go to SQL Editor
3. Copy and paste the contents of `supabase-setup.sql`
4. Click "Run" or press Ctrl+Enter

**Status:** ✅ Ready to run

---

## Migration 002: Add last_holder_check Column

**File:** `MIGRATION_002_add_last_holder_check.sql`

**Description:**
Adds the `last_holder_check` column to track when holder counts were last checked for each token. This enables:
- Live-updating "time since last check" timers in the UI
- Smart priority-based holder checking that avoids checking recently-checked tokens
- Better tracking of which tokens need holder count updates

**To Run:**
1. Open your Supabase Dashboard
2. Go to SQL Editor
3. Copy and paste the contents of `MIGRATION_002_add_last_holder_check.sql`
4. Click "Run" or press Ctrl+Enter

**Status:** ✅ Ready to run

---

## Migration Order

Run migrations in this order:
1. **001** - Initial Schema Setup (supabase-setup.sql)
2. **002** - Add last_holder_check column (MIGRATION_002_add_last_holder_check.sql)

---

## After Running Migrations

1. Update your `.env` file with Supabase credentials (already done)
2. Install dependencies: `npm install` (if not already done)
3. Run the migration script to copy existing JSON data:
   ```powershell
   node src/migrate-to-supabase.js
   ```
4. Restart your backend server

---

## Notes

- The system will automatically fall back to JSON storage if Supabase is not configured
- All existing data in `data/deployments.json` will be preserved
- The migration script will copy JSON data to Supabase without deleting the JSON file

