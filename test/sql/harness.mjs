// Real PostgreSQL (PGlite) with the bits of Supabase the SQL relies on: roles, auth.uid(), auth.users, a realtime publication.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
export async function makeDb(files) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;   -- Supabase turns this on for you
    create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
    create publication supabase_realtime;
    grant usage on schema public, auth, storage to anon, authenticated;
    alter default privileges in schema public grant all on tables to authenticated;
    alter default privileges in schema public grant all on sequences to authenticated;
  `);
  for (const f of files) { try { await db.exec(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error('loading ' + f + ': ' + e.message); } }
  await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated; grant usage on all sequences in schema public to authenticated; grant select, insert, update, delete on storage.objects, storage.buckets to authenticated; grant select on storage.objects to anon;`);
  return db;
}
// Run as a logged-in person (or as nobody) so row-level security applies exactly like Supabase.
export async function as(db, uid, sql, params) {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${uid || ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
