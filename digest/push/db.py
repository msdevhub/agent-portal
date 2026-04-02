"""
Database abstraction layer — PG direct when DATABASE_URL is set, Supabase REST fallback.

All modules should use these functions instead of calling Supabase REST directly.
"""

import json
import os
import urllib.request
from contextlib import contextmanager

# ── Lazy imports to avoid circular dependency with config ──
_pg_pool = None
_pg_available = None


def _get_pool():
    """Lazily create a psycopg2 connection pool."""
    global _pg_pool, _pg_available
    if _pg_available is not None:
        return _pg_pool

    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        _pg_available = False
        return None

    try:
        import psycopg2
        import psycopg2.pool
        _pg_pool = psycopg2.pool.SimpleConnectionPool(1, 5, database_url)
        _pg_available = True
        print(f"[DB] ✅ Connected to PostgreSQL directly")
        return _pg_pool
    except Exception as e:
        print(f"[DB] ⚠️ PG direct connection failed ({e}), falling back to Supabase REST")
        _pg_available = False
        return None


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


def is_pg_direct() -> bool:
    """Return True if using PG direct connection."""
    _get_pool()
    return bool(_pg_available)


# ====================================================================
# Core operations
# ====================================================================

def db_select(table: str, filters: dict | None = None, columns: str = "*",
              order: str | None = None, limit: int | None = None) -> list[dict]:
    """SELECT rows from a table."""
    if is_pg_direct():
        return _pg_select(table, filters, columns, order, limit)
    return _rest_select(table, filters, columns, order, limit)


def db_insert(table: str, data: dict | list[dict], on_conflict: str | None = None) -> list[dict] | None:
    """INSERT one or more rows. Returns inserted rows if available."""
    if is_pg_direct():
        return _pg_insert(table, data, on_conflict)
    return _rest_insert(table, data, on_conflict)


def db_update(table: str, filters: dict, data: dict) -> list[dict] | None:
    """UPDATE rows matching filters."""
    if is_pg_direct():
        return _pg_update(table, filters, data)
    return _rest_update(table, filters, data)


def db_delete(table: str, filters: dict) -> bool:
    """DELETE rows matching filters."""
    if is_pg_direct():
        return _pg_delete(table, filters)
    return _rest_delete(table, filters)


def db_query(sql: str) -> list[dict]:
    """Execute raw SQL and return rows. Use sparingly."""
    if is_pg_direct():
        return _pg_query(sql)
    return _rest_query(sql)


# ====================================================================
# PG Direct Implementation
# ====================================================================

def _pg_select(table, filters, columns, order, limit):
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
    if limit:
        sql += f" LIMIT {limit}"

    with _pg_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]


def _pg_insert(table, data, on_conflict):
    import psycopg2.extras
    rows = data if isinstance(data, list) else [data]
    if not rows:
        return []

    columns = list(rows[0].keys())
    col_names = ", ".join(f'"{c}"' for c in columns)
    placeholders = ", ".join(["%s"] * len(columns))

    if on_conflict:
        # UPSERT: ON CONFLICT (col) DO UPDATE SET ...
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
                    # Convert dicts/lists to JSON strings for jsonb columns
                    if isinstance(v, (dict, list)):
                        v = json.dumps(v, ensure_ascii=False)
                    values.append(v)
                try:
                    cur.execute(sql, values)
                    results.extend([dict(r) for r in cur.fetchall()])
                except Exception as e:
                    conn.rollback()
                    print(f"  ⚠️ PG INSERT error: {e}")
                    # Try without RETURNING for tables that don't support it
                    sql_no_ret = sql.rsplit("RETURNING", 1)[0].strip()
                    cur.execute(sql_no_ret, values)
                    conn.commit()

    return results or None


def _pg_update(table, filters, data):
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


def _pg_delete(table, filters):
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


def _pg_query(sql):
    import psycopg2.extras
    with _pg_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql)
            if cur.description:
                return [dict(r) for r in cur.fetchall()]
            return []


# ====================================================================
# Supabase REST Implementation (fallback)
# ====================================================================

def _rest_headers():
    from config import SUPABASE_SERVICE_KEY
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }


def _rest_url(path: str) -> str:
    from config import SUPABASE_REST
    return f"{SUPABASE_REST}/{path}"


def _rest_call(url: str, data=None, method="GET", extra_headers=None):
    headers = _rest_headers()
    if extra_headers:
        headers.update(extra_headers)

    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode() if data else None,
        headers=headers,
        method=method,
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else ""
        print(f"  ⚠️ REST {method} {url.split('/')[-1]} failed ({e.code}): {error_body[:200]}")
        return None


def _rest_select(table, filters, columns, order, limit):
    parts = [f"{table}?select={columns}"]
    if filters:
        for k, v in filters.items():
            parts[0] += f"&{k}=eq.{v}"
    if order:
        parts[0] += f"&order={order}"
    if limit:
        parts[0] += f"&limit={limit}"
    return _rest_call(_rest_url(parts[0])) or []


def _rest_insert(table, data, on_conflict):
    headers = {"Prefer": "return=representation"}
    if on_conflict:
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        url = _rest_url(f"{table}?on_conflict={on_conflict}")
    else:
        url = _rest_url(table)
    return _rest_call(url, data, "POST", headers)


def _rest_update(table, filters, data):
    filter_str = "&".join(f"{k}=eq.{v}" for k, v in filters.items())
    url = _rest_url(f"{table}?{filter_str}")
    return _rest_call(url, data, "PATCH", {"Prefer": "return=representation"})


def _rest_delete(table, filters):
    filter_str = "&".join(f"{k}=eq.{v}" for k, v in filters.items())
    url = _rest_url(f"{table}?{filter_str}")
    _rest_call(url, method="DELETE")
    return True


def _rest_query(sql):
    from config import SUPABASE_REST
    url = SUPABASE_REST.replace("/rest/v1", "/rest/v1/rpc/run_sql")
    return _rest_call(url, {"query": sql}, "POST") or []
