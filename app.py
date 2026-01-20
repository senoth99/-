import json
import os
import re
import sqlite3
import urllib.parse
import urllib.request
from urllib.error import HTTPError, URLError
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

PASSWORD = os.environ.get("APP_PASSWORD", "admin")
CDEK_CLIENT_ID = os.environ.get("CDEK_CLIENT_ID")
CDEK_CLIENT_SECRET = os.environ.get("CDEK_CLIENT_SECRET")
CDEK_API_BASE = os.environ.get("CDEK_API_BASE", "https://api.cdek.ru/v2")

_CDEK_TOKEN = None
_CDEK_TOKEN_EXPIRES_AT = None


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


def cdek_get_token():
    global _CDEK_TOKEN, _CDEK_TOKEN_EXPIRES_AT
    if _CDEK_TOKEN and _CDEK_TOKEN_EXPIRES_AT:
        if datetime.utcnow() < _CDEK_TOKEN_EXPIRES_AT:
            return _CDEK_TOKEN, None
    if not CDEK_CLIENT_ID or not CDEK_CLIENT_SECRET:
        return None, "Не настроены учетные данные CDEK"
    payload = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": CDEK_CLIENT_ID,
            "client_secret": CDEK_CLIENT_SECRET,
        }
    ).encode("utf-8")
    request_token = urllib.request.Request(
        f"{CDEK_API_BASE}/oauth/token",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request_token, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
            token = data.get("access_token")
            expires_in = data.get("expires_in")
            if token and expires_in:
                _CDEK_TOKEN = token
                _CDEK_TOKEN_EXPIRES_AT = datetime.utcnow() + timedelta(
                    seconds=max(int(expires_in) - 30, 0)
                )
            return token, None
    except Exception as exc:
        return None, f"Ошибка авторизации CDEK: {exc}"


def cdek_request(path):
    token, error = cdek_get_token()
    if error:
        return None, None, error
    request_data = urllib.request.Request(
        f"{CDEK_API_BASE}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request_data, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
            return data, response.status, None
    except HTTPError as exc:
        error_body = None
        try:
            error_body = exc.read().decode("utf-8")
        except Exception:
            error_body = None
        return None, exc.code, f"HTTP Error {exc.code}: {exc.reason}. {error_body or ''}".strip()
    except URLError as exc:
        return None, None, f"Ошибка подключения к CDEK: {exc}"
    except Exception as exc:
        return None, None, f"Ошибка получения статуса CDEK: {exc}"


def extract_cdek_status(order_data):
    if not isinstance(order_data, dict):
        return None
    status = order_data.get("status")
    if isinstance(status, dict):
        location = (
            status.get("city")
            or status.get("city_name")
            or status.get("location")
            or order_data.get("city")
        )
        return {
            "status": status.get("name") or status.get("code") or status.get("status"),
            "location": location,
            "timestamp": status.get("date_time")
            or status.get("date")
            or order_data.get("status_date_time"),
        }
    statuses = order_data.get("statuses") or []
    if statuses:
        latest = statuses[-1]
        location = (
            latest.get("city")
            or latest.get("city_name")
            or latest.get("location")
        )
        return {
            "status": latest.get("name") or latest.get("status") or latest.get("code"),
            "location": location,
            "timestamp": latest.get("date_time") or latest.get("date"),
        }
    return None


def cdek_get_order_uuid_by_cdek_number(cdek_number: str):
    data, status, error = cdek_request(
        f"/orders?cdek_number={urllib.parse.quote(cdek_number)}"
    )
    if error:
        if status == 410:
            return None, "CDEK: неверный тип идентификатора"
        if status == 404:
            return None, "CDEK: заказ не найден"
        return None, error
    orders = []
    if isinstance(data, dict):
        orders = data.get("orders") or []
    if not orders:
        return None, "CDEK: заказ не найден"
    order = orders[0]
    return order.get("uuid"), None


def cdek_get_status(cdek_uuid: str | None, cdek_number: str | None):
    if cdek_uuid:
        order_uuid = cdek_uuid
    elif cdek_number:
        order_uuid, error = cdek_get_order_uuid_by_cdek_number(cdek_number)
        if error:
            return None, error
        if not order_uuid:
            return None, "CDEK: не удалось определить UUID заказа"
    else:
        return None, "Отправление ещё не зарегистрировано в СДЭК"
    order_data, status, error = cdek_request(f"/orders/{urllib.parse.quote(order_uuid)}")
    if error:
        if status == 410:
            return None, "CDEK: неверный тип идентификатора"
        if status == 404:
            return None, "CDEK: заказ не найден"
        return None, error
    status_payload = extract_cdek_status(order_data)
    if not status_payload:
        return None, "Статусы поставки не найдены"
    return status_payload, None


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
            SELECT id, origin_label, destination_label, internal_number,
                   cdek_number, cdek_uuid, cdek_state,
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
    internal_number = (
        payload.get("internal_number") or payload.get("track_number") or ""
    ).strip()
    cdek_number = (payload.get("cdek_number") or "").strip() or None
    cdek_uuid = (payload.get("cdek_uuid") or "").strip() or None
    if not origin_label or not destination_label or not internal_number:
        return jsonify({"error": "Заполните все поля поставки"}), 400
    status_data = {
        "status": "⏳ Ожидает регистрации в СДЭК",
        "location": None,
        "timestamp": None,
    }
    cdek_state = "CREATED_INTERNAL"
    if cdek_uuid or cdek_number:
        status_data["status"] = "Готово к отслеживанию в СДЭК"
        cdek_state = "REGISTERED"
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO shipments
            (origin_label, destination_label, internal_number, cdek_number, cdek_uuid, cdek_state,
             last_status, last_location, last_update, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                origin_label,
                destination_label,
                internal_number,
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
            "SELECT internal_number, cdek_number, cdek_uuid FROM shipments WHERE id = ?",
            (shipment_id,),
        ).fetchone()
        if not shipment:
            return jsonify({"error": "Поставка не найдена"}), 404
        status_data, error = cdek_get_status(
            shipment["cdek_uuid"], shipment["cdek_number"]
        )
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
                "IN_TRANSIT",
                shipment_id,
            ),
        )
    return jsonify({"ok": True})


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
