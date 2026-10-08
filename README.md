# NEVERLOSE-style website

Static GitHub Pages frontend with Supabase authentication and a cloud market for configs and Lua scripts.

The market supports search, authenticated uploads, private signed downloads, file validation, and a 5 MB limit.

## Enable accounts

1. Create a Supabase project.
2. Open SQL Editor and run `supabase.sql`. It creates the tables, private `market` bucket, and access policies.
3. In Authentication → URL Configuration, add the final GitHub Pages URL to Site URL and Redirect URLs.
4. Copy the Project URL and `anon` public key into `config.js`.
5. Never place the `service_role` key in this repository.

## Publish on GitHub Pages

Create a repository, copy these files into it, push the `main` branch, then enable GitHub Pages with “GitHub Actions” as the source. The included workflow publishes the site.

## Local preview

Serve the folder over HTTP. Authentication redirects do not work correctly when opening `index.html` directly from disk.
