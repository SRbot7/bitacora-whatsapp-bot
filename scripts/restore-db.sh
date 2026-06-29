#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_CONTAINER="${DB_CONTAINER:-postgres-operaciones}"
DB_USER="${DB_USER:-admin}"
DB_NAME="${DB_NAME:-operaciones}"

if [[ $# -ne 1 ]]; then
    echo "Uso: $0 <archivo_sql>"
    exit 1
fi

SQL_FILE="$1"

if [[ ! -f "$SQL_FILE" ]]; then
    echo "No existe el archivo: $SQL_FILE"
    exit 1
fi

if [[ -f "$ROOT_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
fi

echo "ATENCION: esta accion restaurara la base de datos '$DB_NAME' en el contenedor '$DB_CONTAINER'."
echo "Escribe RESTAURAR para continuar:"
read -r CONFIRM

if [[ "$CONFIRM" != "RESTAURAR" ]]; then
    echo "Operacion cancelada."
    exit 1
fi

echo "Restaurando base de datos desde $SQL_FILE"
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$SQL_FILE"
echo "Restauracion completada."
