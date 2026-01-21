import json
import logging
import os
import re
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

import pandas as pd
from flask import Flask, jsonify, render_template, request, send_file, session
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", "/data")
DB_PATH = os.path.join(DATA_DIR, "crm.db")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "dev-secret")
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
app.config["UPLOAD_DIR"] = UPLOAD_DIR

logger = logging.getLogger(__name__)

PASSWORD = os.environ.get("APP_PASSWORD", "admin")
CDEK_API_BASE_URL = "https://api.cdek.ru/v2"
CDEK_TOKEN_URL = f"{CDEK_API_BASE_URL}/oauth/token"
CDEK_ORDERS_URL = f"{CDEK_API_BASE_URL}/orders"
CDEK_TOKEN_REFRESH_BUFFER = timedelta(seconds=60)
_CDEK_TOKEN_CACHE = {"token": None, "expires_at": datetime.min}


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                address TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                location_id INTEGER NOT NULL,
                product TEXT NOT NULL,
                stock INTEGER,
                sales_qty INTEGER,
                sales_amount REAL,
                record_date TEXT,
                source_file TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(location_id) REFERENCES locations(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS shipments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                origin_label TEXT NOT NULL,
                destination_label TEXT NOT NULL,
                internal_number TEXT NOT NULL,
                display_number TEXT,
                cdek_number TEXT,
                cdek_uuid TEXT,
                cdek_state TEXT,
                last_status TEXT,
                last_location TEXT,
                last_update TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(shipments)").fetchall()
        }
        if "track_number" in columns and "internal_number" not in columns:
            conn.execute("ALTER TABLE shipments RENAME COLUMN track_number TO internal_number")
            columns.discard("track_number")
            columns.add("internal_number")
        if "internal_number" not in columns:
            conn.execute("ALTER TABLE shipments ADD COLUMN internal_number TEXT")
        if "display_number" not in columns:
            conn.execute("ALTER TABLE shipments ADD COLUMN display_number TEXT")
        if "cdek_number" not in columns:
            conn.execute("ALTER TABLE shipments ADD COLUMN cdek_number TEXT")
        if "cdek_uuid" not in columns:
            conn.execute("ALTER TABLE shipments ADD COLUMN cdek_uuid TEXT")
        if "cdek_state" not in columns:
            conn.execute("ALTER TABLE shipments ADD COLUMN cdek_state TEXT")


def normalize_columns(columns):
    return [str(col).strip().lower() for col in columns]


def infer_columns(columns):
    column_map = {
        "product": ["товар", "наименование", "product", "sku", "позиция", "номенклатура"],
        "brand": ["бренд", "brand"],
        "characteristic": ["характеристика", "характеристики", "variation", "size", "цвет"],
        "stock": ["остаток", "stock", "остатки", "balance", "отгруз факт", "отгрузка факт"],
        "sales_qty": [
            "продажи",
            "количество продаж",
            "sales qty",
            "qty",
            "sold",
            "отгруз по списку",
            "отгрузка по списку",
        ],
        "sales_amount": ["сумма", "выручка", "amount", "sales amount", "revenue"],
        "record_date": ["дата", "date", "период"],
    }
    normalized = normalize_columns(columns)
    resolved = {}
    for key, keywords in column_map.items():
        for idx, column in enumerate(normalized):
            if any(keyword in column for keyword in keywords):
                resolved[key] = columns[idx]
                break
    return resolved


def coerce_number(value):
    if pd.isna(value):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.search(r"-?\\d+[\\.,]?\\d*", str(value))
    if not match:
        return None
    return float(match.group(0).replace(",", "."))


def parse_excel(path):
    if path.lower().endswith(".csv"):
        data = pd.read_csv(path)
    else:
        data = pd.read_excel(path)
    mapping = infer_columns(list(data.columns))
    required = ["product", "stock"]
    missing = [key for key in required if key not in mapping]
    if missing:
        return None, f"Не найдены колонки: {', '.join(missing)}"
    rename_map = {}
    for key in [
        "product",
        "stock",
        "sales_qty",
        "sales_amount",
        "record_date",
        "brand",
        "characteristic",
    ]:
        if key in mapping:
            rename_map[mapping[key]] = key
    parsed = data.rename(columns=rename_map)
    if "brand" in parsed.columns or "characteristic" in parsed.columns:
        parsed["product"] = parsed.apply(
            lambda row: " ".join(
                str(value).strip()
                for value in [
                    row.get("brand"),
                    row.get("product"),
                    row.get("characteristic"),
                ]
                if pd.notna(value) and str(value).strip()
            ),
            axis=1,
        )
    parsed["stock"] = parsed["stock"].apply(coerce_number)
    if "sales_qty" in parsed.columns:
        parsed["sales_qty"] = parsed["sales_qty"].apply(coerce_number)
    else:
        parsed["sales_qty"] = None
    if "sales_amount" in parsed.columns:
        parsed["sales_amount"] = parsed["sales_amount"].apply(coerce_number)
    else:
        parsed["sales_amount"] = None
    if "record_date" not in parsed.columns:
        parsed["record_date"] = None
    parsed = parsed[["product", "stock", "sales_qty", "sales_amount", "record_date"]]
    return parsed, None


def require_auth():
    open_paths = {"/", "/api/login", "/api/logout"}
    if request.path.startswith("/static"):
        return None
    if request.path in open_paths:
        return None
    if not session.get("authed"):
        return jsonify({"error": "unauthorized"}), 401
    return None


class TrackingError(Exception):
    def __init__(self, code, details=None):
        super().__init__(details or code)
        self.code = code
        self.details = details or code


def _get_cdek_credentials():
    client_id = os.environ.get("CDEK_CLIENT_ID", "").strip()
    client_secret = os.environ.get("CDEK_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        logger.error("CDEK credentials are missing")
        raise TrackingError("CDEK_AUTH_MISSING")
    return client_id, client_secret


def _request_cdek_token():
    client_id, client_secret = _get_cdek_credentials()
    payload = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        }
    ).encode("utf-8")
    request_obj = urllib.request.Request(
        CDEK_TOKEN_URL,
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(request_obj, timeout=20) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        logger.exception("CDEK token request failed with status %s", exc.code)
        raise TrackingError("CDEK_AUTH_FAILED") from exc
    except Exception as exc:
        logger.exception("CDEK token request failed")
        raise TrackingError("CDEK_AUTH_FAILED") from exc
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        logger.exception("CDEK token response is not JSON")
        raise TrackingError("CDEK_AUTH_FAILED") from exc
    token = data.get("access_token")
    expires_in = data.get("expires_in", 0)
    if not token:
        raise TrackingError("CDEK_AUTH_FAILED")
    expires_at = datetime.utcnow() + timedelta(seconds=int(expires_in or 0))
    _CDEK_TOKEN_CACHE["token"] = token
    _CDEK_TOKEN_CACHE["expires_at"] = expires_at
    return token


def _get_cdek_token(force_refresh=False):
    now = datetime.utcnow()
    token = _CDEK_TOKEN_CACHE.get("token")
    expires_at = _CDEK_TOKEN_CACHE.get("expires_at", datetime.min)
    if not force_refresh and token and now + CDEK_TOKEN_REFRESH_BUFFER < expires_at:
        return token
    return _request_cdek_token()


def _parse_cdek_status(entity, track_number):
    statuses = entity.get("statuses") or []
    if not statuses:
        return {
            "track_number": entity.get("cdek_number") or track_number,
            "status": {
                "code": "UNKNOWN",
                "name": "Статус неизвестен",
                "date_time": None,
                "city": None,
            },
            "statuses": [],
        }
    latest = max(
        statuses,
        key=lambda status: status.get("date_time") or "",
    )
    return {
        "track_number": entity.get("cdek_number") or track_number,
        "status": {
            "code": latest.get("code"),
            "name": latest.get("name"),
            "date_time": latest.get("date_time"),
            "city": latest.get("city"),
        },
        "statuses": statuses,
    }


def _fetch_cdek_order(track_number, token):
    url = f"{CDEK_ORDERS_URL}?cdek_number={urllib.parse.quote(track_number)}"
    request_obj = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request_obj, timeout=20) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            raise TrackingError("CDEK_UNAUTHORIZED") from exc
        if exc.code == 404:
            raise TrackingError("ORDER_NOT_FOUND") from exc
        logger.exception("CDEK tracking failed with status %s", exc.code)
        raise TrackingError("CDEK_API_ERROR") from exc
    except Exception as exc:
        logger.exception("CDEK tracking failed")
        raise TrackingError("CDEK_API_ERROR") from exc

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        logger.exception("CDEK tracking response is not JSON")
        raise TrackingError("CDEK_API_ERROR") from exc

    entity = data.get("entity") if isinstance(data, dict) else None
    if not entity:
        raise TrackingError("ORDER_NOT_FOUND")
    return _parse_cdek_status(entity, track_number)


def cdek_track(track_number):
    cleaned = (track_number or "").strip()
    if not cleaned:
        raise TrackingError("INVALID_TRACK_NUMBER")

    token = _get_cdek_token()
    try:
        return _fetch_cdek_order(cleaned, token)
    except TrackingError as exc:
        if exc.code != "CDEK_UNAUTHORIZED":
            raise
        token = _get_cdek_token(force_refresh=True)
        return _fetch_cdek_order(cleaned, token)


def resolve_shipment_status(track_number):
    try:
        tracking = cdek_track(track_number)
    except TrackingError as exc:
        return None, exc.code
    status = tracking.get("status") or {}
    status_name = status.get("name") or status.get("code") or "UNKNOWN"
    return {
        "status": status_name,
        "location": status.get("city"),
        "timestamp": status.get("date_time"),
        "code": status.get("code") or "UNKNOWN",
    }, None


app.before_request(require_auth)


@app.route("/")
def index():
    return render_template("index.html", authed=bool(session.get("authed")))


@app.post("/api/login")
def login():
    payload = request.get_json() or {}
    if payload.get("password") == PASSWORD:
        session["authed"] = True
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": "Неверный пароль"}), 401


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/locations")
def get_locations():
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT l.id, l.name, l.address,
                   COALESCE(SUM(r.stock), 0) AS total_stock,
                   COALESCE(SUM(r.sales_qty), 0) AS total_sales_qty,
                   COALESCE(SUM(r.sales_amount), 0) AS total_sales_amount,
                   MAX(r.created_at) AS last_update
            FROM locations l
            LEFT JOIN records r ON r.location_id = l.id
            GROUP BY l.id
            ORDER BY l.created_at DESC
            """
        ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/locations")
def add_location():
    payload = request.get_json() or {}
    name = payload.get("name", "").strip()
    address = payload.get("address", "").strip()
    if not name:
        return jsonify({"error": "Название обязательно"}), 400
    with get_db() as conn:
        conn.execute(
            "INSERT INTO locations (name, address, created_at) VALUES (?, ?, ?)",
            (name, address, datetime.utcnow().isoformat()),
        )
    return jsonify({"ok": True})


@app.get("/api/records/<int:location_id>")
def get_records(location_id):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, product, stock, sales_qty, sales_amount, record_date, source_file, created_at
            FROM records
            WHERE location_id = ?
            ORDER BY created_at DESC
            """
            ,
            (location_id,),
        ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.delete("/api/locations/<int:location_id>")
def delete_location(location_id):
    with get_db() as conn:
        conn.execute("DELETE FROM records WHERE location_id = ?", (location_id,))
        result = conn.execute("DELETE FROM locations WHERE id = ?", (location_id,))
        if result.rowcount == 0:
            return jsonify({"error": "Точка продаж не найдена"}), 404
    return jsonify({"ok": True})


@app.post("/api/upload")
def upload_file():
    location_id = request.form.get("location_id", type=int)
    file = request.files.get("file")
    if not location_id:
        return jsonify({"error": "Нужен идентификатор точки"}), 400
    if not file:
        return jsonify({"error": "Файл не найден"}), 400
    filename = secure_filename(file.filename)
    if not filename:
        return jsonify({"error": "Неверное имя файла"}), 400
    path = os.path.join(app.config["UPLOAD_DIR"], filename)
    file.save(path)
    data, error = parse_excel(path)
    if error:
        return jsonify({"error": error}), 400
    with get_db() as conn:
        for _, row in data.iterrows():
            conn.execute(
                """
                INSERT INTO records
                (location_id, product, stock, sales_qty, sales_amount, record_date, source_file, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """
                ,
                (
                    location_id,
                    str(row["product"]),
                    int(row["stock"]) if pd.notna(row["stock"]) else None,
                    int(row["sales_qty"]) if pd.notna(row["sales_qty"]) else None,
                    float(row["sales_amount"]) if pd.notna(row["sales_amount"]) else None,
                    str(row["record_date"]) if pd.notna(row["record_date"]) else None,
                    filename,
                    datetime.utcnow().isoformat(),
                ),
            )
    return jsonify({"ok": True})


@app.get("/api/export")
def export_excel():
    with get_db() as conn:
        locations = conn.execute("SELECT id, name FROM locations ORDER BY name").fetchall()
        export_path = os.path.join(DATA_DIR, "export.xlsx")
        with pd.ExcelWriter(export_path, engine="openpyxl") as writer:
            for location in locations:
                records = conn.execute(
                    """
                    SELECT product, stock, sales_qty, sales_amount, record_date, source_file, created_at
                    FROM records
                    WHERE location_id = ?
                    ORDER BY created_at DESC
                    """
                    ,
                    (location["id"],),
                ).fetchall()
                df = pd.DataFrame(records)
                if df.empty:
                    df = pd.DataFrame(columns=[
                        "product",
                        "stock",
                        "sales_qty",
                        "sales_amount",
                        "record_date",
                        "source_file",
                        "created_at",
                    ])
                sheet_name = location["name"][:31] if location["name"] else f"Локация {location['id']}"
                df.to_excel(writer, index=False, sheet_name=sheet_name)
    return send_file(export_path, as_attachment=True, download_name="crm_export.xlsx")


@app.get("/api/shipments")
def get_shipments():
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, origin_label, destination_label, internal_number, display_number,
                   cdek_state,
                   last_status, last_location, last_update, created_at
            FROM shipments
            ORDER BY created_at DESC
            """
        ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/shipments")
def add_shipment():
    payload = request.get_json() or {}
    origin_label = payload.get("origin_label", "").strip()
    destination_label = payload.get("destination_label", "").strip()
    display_number = (
        payload.get("display_number")
        or payload.get("internal_number")
        or payload.get("track_number")
        or ""
    ).strip()
    internal_number = display_number
    cdek_number = display_number or None
    cdek_uuid = None
    if not origin_label or not destination_label or not display_number:
        return jsonify({"error": "Заполните все поля поставки"}), 400
    status_data, error = resolve_shipment_status(display_number)
    if error:
        status_data = {
            "status": "⏳ Ожидает регистрации в CDEK",
            "location": None,
            "timestamp": None,
            "code": "PENDING_REGISTRATION",
        }
    cdek_state = status_data.get("code") or "PENDING_REGISTRATION"
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO shipments
            (origin_label, destination_label, internal_number, display_number, cdek_number, cdek_uuid, cdek_state,
             last_status, last_location, last_update, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                origin_label,
                destination_label,
                internal_number,
                display_number,
                cdek_number,
                cdek_uuid,
                cdek_state,
                status_data.get("status"),
                status_data.get("location"),
                status_data.get("timestamp"),
                datetime.utcnow().isoformat(),
            ),
        )
    return jsonify({"ok": True})


@app.post("/api/shipments/<int:shipment_id>/refresh")
def refresh_shipment(shipment_id):
    with get_db() as conn:
        shipment = conn.execute(
            "SELECT display_number FROM shipments WHERE id = ?",
            (shipment_id,),
        ).fetchone()
        if not shipment:
            return jsonify({"error": "Поставка не найдена"}), 404
        track_number = shipment["display_number"]
        if not track_number:
            return jsonify({"error": "Не задан трек-номер поставки"}), 409
        status_data, error = resolve_shipment_status(track_number)
        if error:
            return jsonify({"error": error}), 409
        conn.execute(
            """
            UPDATE shipments
            SET last_status = ?, last_location = ?, last_update = ?, cdek_state = ?
            WHERE id = ?
            """,
            (
                status_data.get("status"),
                status_data.get("location"),
                status_data.get("timestamp"),
                status_data.get("code"),
                shipment_id,
            ),
        )
    return jsonify({"ok": True})


@app.post("/api/track")
def track_public_shipment():
    payload = request.get_json() or {}
    track_number = (payload.get("track_number") or "").strip()
    if not track_number:
        return jsonify({"error": "INVALID_TRACK_NUMBER"}), 400
    try:
        data = cdek_track(track_number)
    except TrackingError as exc:
        status_map = {
            "ORDER_NOT_FOUND": 404,
            "INVALID_TRACK_NUMBER": 400,
            "CDEK_AUTH_MISSING": 500,
            "CDEK_AUTH_FAILED": 502,
            "CDEK_UNAUTHORIZED": 502,
            "CDEK_API_ERROR": 502,
        }
        return jsonify({"error": exc.code}), status_map.get(exc.code, 502)
    return jsonify(data)


@app.delete("/api/shipments/<int:shipment_id>")
def delete_shipment(shipment_id):
    with get_db() as conn:
        result = conn.execute(
            "DELETE FROM shipments WHERE id = ?",
            (shipment_id,),
        )
        if result.rowcount == 0:
            return jsonify({"error": "Поставка не найдена"}), 404
    return jsonify({"ok": True})


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=80, debug=True)
