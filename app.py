import json
import os
import sqlite3
import urllib.parse
import urllib.request
from datetime import datetime

import pandas as pd
from flask import Flask, jsonify, render_template, request, send_file, session
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "crm.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "dev-secret")
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
app.config["UPLOAD_DIR"] = UPLOAD_DIR

PASSWORD = os.environ.get("APP_PASSWORD", "admin")
CDEK_CLIENT_ID = os.environ.get("CDEK_CLIENT_ID")
CDEK_CLIENT_SECRET = os.environ.get("CDEK_CLIENT_SECRET")
CDEK_API_BASE = os.environ.get("CDEK_API_BASE", "https://api.cdek.ru/v2")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
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
                track_number TEXT NOT NULL,
                last_status TEXT,
                last_location TEXT,
                last_update TEXT,
                created_at TEXT NOT NULL
            )
            """
        )


def normalize_columns(columns):
    return [str(col).strip().lower() for col in columns]


def infer_columns(columns):
    column_map = {
        "product": ["товар", "наименование", "product", "sku", "позиция"],
        "stock": ["остаток", "stock", "остатки", "balance"],
        "sales_qty": ["продажи", "количество продаж", "sales qty", "qty", "sold"],
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


def parse_excel(path):
    if path.lower().endswith(".csv"):
        data = pd.read_csv(path)
    else:
        data = pd.read_excel(path)
    mapping = infer_columns(list(data.columns))
    required = ["product", "stock", "sales_qty", "sales_amount"]
    missing = [key for key in required if key not in mapping]
    if missing:
        return None, f"Не найдены колонки: {', '.join(missing)}"
    parsed = data.rename(columns={
        mapping["product"]: "product",
        mapping["stock"]: "stock",
        mapping["sales_qty"]: "sales_qty",
        mapping["sales_amount"]: "sales_amount",
        mapping.get("record_date", ""): "record_date",
    })
    if "record_date" not in parsed.columns:
        parsed["record_date"] = None
    parsed = parsed[["product", "stock", "sales_qty", "sales_amount", "record_date"]]
    return parsed, None


def require_auth():
    if request.endpoint in {"login", "static"}:
        return None
    if not session.get("authed"):
        return jsonify({"error": "unauthorized"}), 401
    return None


def cdek_get_token():
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
        f"{CDEK_API_BASE}/oauth/token?{payload.decode('utf-8')}",
        method="POST",
    )
    try:
        with urllib.request.urlopen(request_token, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
            return data.get("access_token"), None
    except Exception as exc:
        return None, f"Ошибка авторизации CDEK: {exc}"


def cdek_get_status(track_number):
    token, error = cdek_get_token()
    if error:
        return None, error
    request_status = urllib.request.Request(
        f"{CDEK_API_BASE}/orders?cdek_number={urllib.parse.quote(track_number)}",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request_status, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
            orders = data.get("orders") or []
            if not orders:
                return None, "Не найдено данных по трек-номеру"
            status_info = orders[0].get("statuses", [])
            if not status_info:
                return None, "Статусы поставки не найдены"
            latest = status_info[-1]
            return {
                "status": latest.get("name") or latest.get("code"),
                "location": latest.get("city") or latest.get("city_code"),
                "timestamp": latest.get("date_time"),
            }, None
    except Exception as exc:
        return None, f"Ошибка получения статуса CDEK: {exc}"


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
        export_path = os.path.join(BASE_DIR, "export.xlsx")
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
            SELECT id, origin_label, destination_label, track_number,
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
    track_number = payload.get("track_number", "").strip()
    if not origin_label or not destination_label or not track_number:
        return jsonify({"error": "Заполните все поля поставки"}), 400
    status_data, error = cdek_get_status(track_number)
    if error:
        status_data = {"status": error, "location": None, "timestamp": None}
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO shipments
            (origin_label, destination_label, track_number, last_status, last_location, last_update, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                origin_label,
                destination_label,
                track_number,
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
            "SELECT track_number FROM shipments WHERE id = ?",
            (shipment_id,),
        ).fetchone()
        if not shipment:
            return jsonify({"error": "Поставка не найдена"}), 404
        status_data, error = cdek_get_status(shipment["track_number"])
        if error:
            return jsonify({"error": error}), 400
        conn.execute(
            """
            UPDATE shipments
            SET last_status = ?, last_location = ?, last_update = ?
            WHERE id = ?
            """,
            (
                status_data.get("status"),
                status_data.get("location"),
                status_data.get("timestamp"),
                shipment_id,
            ),
        )
    return jsonify({"ok": True})


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=80, debug=True)
