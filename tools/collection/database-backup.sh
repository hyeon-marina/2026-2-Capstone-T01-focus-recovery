#!/bin/sh
# Run only on a dedicated approved collection project. New, owner-only local snapshot.
set -eu
if [ "$#" -ne 3 ]; then echo 'Usage: database-backup.sh PROJECT ENV_FILE NEW_OUTPUT.sql' >&2; exit 2; fi
project=$1
env_file=$2
output=$3
case "$project" in focus-collection-*) ;; *) echo 'Dedicated focus-collection-* project required' >&2; exit 2;; esac
umask 077
set -C
exec 3> "$output"
# Secret is read only inside the DB container; never echoed or placed in host arguments.
docker compose -p "$project" --env-file "$env_file" -f deploy/collection/compose.yml exec -T mysql sh -c \
 'MYSQL_PWD="$(cat /run/secrets/mysql-root)"; export MYSQL_PWD; exec mysqldump -uroot --single-transaction --routines --triggers --hex-blob --no-tablespaces --set-gtid-purged=OFF focus_collection' >&3
echo 'Local backup written. Encrypt and restrict off-host copies; maintain a separate latest retraction ledger.'
