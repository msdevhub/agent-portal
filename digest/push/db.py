"""
Database abstraction layer — PostgreSQL direct connection only.

All modules should use these functions instead of raw SQL.
Requires DATABASE_URL environment variable.
"""

import json
import os
import sys
from contextlib import contextmanager

_pg_pool = None
_initialized = False


def _get_pool():
    """Create a psycopg2 connection pool. Exits if DATABASE_URL is missing."""
    global _pg_pool, _initialized
    if _initialized:
        return _pg_pool

    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        print("[DB] ❌ DATABASE_URL is required but not set. Exiting.", file=sys.stderr)
        sys.exit(1)

    import psycopg2
    import psycopg2.pool
    _pg_pool = psycopg2.pool.SimpleConnectionPool(1, 5, database_url)
    _initialized = True
    print("[DB] ✅ Connected to PostgreSQL")
    return _pg_pool


@contextmanager
def _pg_conn():
    """Get a PG connection from the pool, auto-return on exit."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


# ====================================================================
# Core operations
# ====================================================================

def db_select(table: str, filters: dict | None = None, columns: str = "*",
              order: str | None = None, limit: int | None = None) -> list[dict]:
    """SELECT rows from a table."""
    import psycopg2.extras
    sql = f'SELECT {columns} FROM "{table}"'
    params = []
    if filters:
        clauses = []
        for k, v in filters.items():
            clauses.append(f'"{k}" = %s')
            params.append(v)
        sql += " WHERE " + " AND ".join(clauses)
    if order:
        sql += f" ORDER BY {order}"
    if limit is not None:
        sql += f" LIMIT {limit}"

    with _pg_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]


def db_insert(table: str, data: dict | list[dict], on_conflict: str | None = None) -> list[dict] | None:
    """INSERT one or more rows. Returns inserted rows if available."""
    import psycopg2.extras
    rows = data if isinstance(data, list) else [data]
    if not rows:
        return []

    columns = list(rows[0].keys())
    col_names = ", ".join(f'"{c}"' for c in columns)
    placeholders = ", ".join(["%s"] * len(columns))

    if on_conflict:
        update_cols = [c for c in columns if c != on_conflict]
        update_set = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in update_cols)
        sql = (f'INSERT INTO "{table}" ({col_names}) VALUES ({placeholders}) '
               f'ON CONFLICT ("{on_conflict}") DO UPDATE SET {update_set} '
               f'RETURNING *')
    else:
        sql = f'INSERT INTO "{table}" ({col_names}) VALUES ({placeholders}) RETURNING *'

    results = []
    with _pg_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            for row in rows:
                values = []
                for c in columns:
                    v = row.get(c)
                    if isinstance(v, (dict, list)):
                        v = json.dumps(v, ensure_ascii=False)
                    values.append(v)
                try:
                    cur.execute(sql, values)
                    results.extend([dict(r) for r in cur.fetchall()])
                except Exception as e:
                    conn.rollback()
                    print(f"  ⚠️ PG INSERT error: {e}")
                    sql_no_ret = sql.rsplit("RETURNING", 1)[0].strip()
                    cur.execute(sql_no_ret, values)
                    conn.commit()

    return results or None


def db_update(table: str, filters: dict, data: dict) -> list[dict] | None:
    """UPDATE rows matching filters."""
    import psycopg2.extras
    set_parts = []
    params = []
    for k, v in data.items():
        set_parts.append(f'"{k}" = %s')
        if isinstance(v, (dict, list)):
            v = json.dumps(v, ensure_ascii=False)
        params.append(v)

    where_parts = []
    for k, v in filters.items():
        where_parts.append(f'"{k}" = %s')
        params.append(v)

    sql = f'UPDATE "{table}" SET {", ".join(set_parts)} WHERE {" AND ".join(where_parts)} RETURNING *'

    with _pg_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]


def db_delete(table: str, filters: dict) -> bool:
    """DELETE rows matching filters."""
    params = []
    where_parts = []
    for k, v in filters.items():
        where_parts.append(f'"{k}" = %s')
        params.append(v)

    sql = f'DELETE FROM "{table}" WHERE {" AND ".join(where_parts)}'

    with _pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return True


def db_query(sql: str) -> list[dict]:
    """Execute raw SQL and return rows. Use sparingly."""
    import psycopg2.extras
    with _pg_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql)
            if cur.description:
                return [dict(r) for r in cur.fetchall()]
            return []
