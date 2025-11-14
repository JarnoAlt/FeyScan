/**
 * Migration script to copy existing JSON data to Supabase
 * Run with: node src/migrate-to-supabase.js
 */

import { migrateJSONToSupabase } from './supabase-storage.js';

console.log('Starting migration from JSON to Supabase...');
await migrateJSONToSupabase();
console.log('Migration script completed.');
process.exit(0);

