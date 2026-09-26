#!/bin/sh
# Nightly backup of the database and call recordings, kept for 7 days.
# Installed on the server by ops/install-backup.sh.
set -eu

DIR=/var/backups/pestlaunch
KEEP_DAYS=7
STAMP=$(date -u +%Y%m%d-%H%M)

mkdir -p "$DIR"
chmod 700 "$DIR"

docker exec pestlaunch-postgres-1 pg_dump -U callsentry -d callsentry -Fc > "$DIR/db-$STAMP.dump"
docker run --rm -v pestlaunch_uploads:/data:ro alpine tar czf - -C /data . > "$DIR/recordings-$STAMP.tgz"
chmod 600 "$DIR"/*

find "$DIR" -type f -mtime +"$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) backup ok: $(du -sh "$DIR" | cut -f1) in $DIR"
