# Moments ♥

A small, private web app for two people to share recent activities, photos and comments.

- Static HTML/CSS/vanilla JS (ES modules, no build step), hosted on GitHub Pages.
- Supabase for Auth, Postgres, Storage and Realtime. Only the project URL and the publishable (anon) key live in `config.js`; access is enforced by Row Level Security.
- The database schema and security policies are in `supabase/schema.sql` (idempotent; paste into the Supabase SQL editor).
