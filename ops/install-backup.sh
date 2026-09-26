#!/bin/sh
# Run once on the server as root: installs the nightly backup at 03:15 UTC.
set -eu
install -m 700 "$(dirname "$0")/backup.sh" /opt/pestlaunch/backup.sh
echo "15 3 * * * root /opt/pestlaunch/backup.sh >> /var/log/pestlaunch-backup.log 2>&1" \
  > /etc/cron.d/pestlaunch-backup
chmod 644 /etc/cron.d/pestlaunch-backup
echo "installed; restore with: docker exec -i pestlaunch-postgres-1 pg_restore -U callsentry -d callsentry --clean --if-exists < /var/backups/pestlaunch/db-<stamp>.dump"
