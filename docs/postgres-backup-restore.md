# Postgres Backup & Restore

This runbook documents how to back up and restore the Nova Social Club Postgres database.

## When to Use

- Before major schema changes or data migrations
- Periodic scheduled backups (recommend: keep at least 7 daily backups)
- Before any risky data operations
- To migrate data between environments

## Prerequisites

1. **PostgreSQL client tools** installed (`pg_dump`, `pg_restore`, `psql`):
   ```bash
   # macOS
   brew install postgresql

   # Ubuntu/Debian
   sudo apt-get install postgresql-client

   # Verify installation
   pg_dump --version
   ```

2. **DATABASE_URL** environment variable set to your Postgres connection string:
   ```bash
   export DATABASE_URL="postgresql://user:password@host:5432/dbname"
   ```
   On Replit, this is set automatically when you enable PostgreSQL (see `docs/DEPLOY.md`).

3. **Network access** to the database host from your machine.

## Backup (pg_dump)

### Custom format (recommended for restore flexibility)

```bash
pg_dump "$DATABASE_URL" -Fc -f backups/nova-$(date +%Y%m%d-%H%M%S).dump
```

- `-Fc` creates a custom-format archive (compressed, supports selective restore)
- The timestamp ensures unique filenames for each backup

### Plain SQL format (human-readable)

```bash
pg_dump "$DATABASE_URL" -Fp -f backups/nova-$(date +%Y%m%d-%H%M%S).sql
```

- `-Fp` creates plain-text SQL (can be inspected, edited, piped to `psql`)

### Verify the backup file exists

```bash
ls -lh backups/nova-*.dump
```

## Optional Script

A helper script is available at `scripts/backup-postgres.sh`:

```bash
# Make executable (first time only)
chmod +x scripts/backup-postgres.sh

# Run backup
./scripts/backup-postgres.sh
```

The script:
- Validates `DATABASE_URL` is set
- Creates `backups/` directory if missing
- Writes timestamped `.dump` files in custom format
- Exits non-zero on any error

## Restore

**Always test restores on a staging database first.** Never restore directly to production without verification.

### To a fresh/empty database

Using custom format (`.dump`):
```bash
pg_restore -d "$DATABASE_URL" --clean --if-exists backups/nova-YYYYMMDD-HHMMSS.dump
```

Using plain SQL (`.sql`):
```bash
psql "$DATABASE_URL" < backups/nova-YYYYMMDD-HHMMSS.sql
```

### Restore options explained

- `--clean`: Drops existing objects before recreating (use with caution)
- `--if-exists`: Suppresses errors if objects don't exist yet
- `-d "$DATABASE_URL"`: Target database connection string

### Restore to a different database (staging)

```bash
export STAGING_DATABASE_URL="postgresql://user:password@staging-host:5432/staging_db"
pg_restore -d "$STAGING_DATABASE_URL" --clean --if-exists backups/nova-YYYYMMDD-HHMMSS.dump
```

## Verify

After restoring, confirm data integrity:

1. **Check row counts for key tables**:
   ```bash
   psql "$DATABASE_URL" -c "SELECT 'members' as tbl, count(*) FROM members
     UNION ALL SELECT 'applications', count(*) FROM applications
     UNION ALL SELECT 'subscriptions', count(*) FROM subscriptions
     UNION ALL SELECT 'membership_levels', count(*) FROM membership_levels;"
   ```

2. **Smoke test login**: Attempt to log in to `/admin` or `/member` to confirm auth data is intact.

3. **Check recent records**: Query a few recent rows to ensure timestamps and data look correct:
   ```bash
   psql "$DATABASE_URL" -c "SELECT id, email, created_at FROM members ORDER BY created_at DESC LIMIT 5;"
   ```

## Retention

Recommended retention policy:
- Keep **7 daily backups** minimum
- Keep **4 weekly backups** (one per week, retained longer)
- Delete older backups to save storage

Example cleanup of backups older than 7 days:
```bash
find backups/ -name "nova-*.dump" -mtime +7 -delete
```

## PGlite / Local Memory Note

When running locally **without** `DATABASE_URL` set (or with `USE_MEMORY_DB=1`), the app uses an in-memory PGlite database. This data:

- Resets on every restart
- Cannot be backed up with `pg_dump` (it's not a real Postgres server)
- Is intended only for local development and testing

For any data you need to keep, always use a real Postgres database with `DATABASE_URL` set.

## What NOT to Commit

Never commit to version control:
- `.env` files containing `DATABASE_URL` or other secrets
- Database dump files (`*.dump`, `*.sql` backups)
- Credentials, API keys, or connection strings

The `backups/` directory is listed in `.gitignore` to prevent accidental commits.
