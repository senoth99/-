import json
import logging
import os
import re
import sqlite3
from datetime import datetime, timedelta
from hashlib import sha256

import pandas as pd
from flask import Flask, jsonify, redirect, render_template, request, send_file, session
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
ADMIN_LOGIN = os.environ.get("APP_ADMIN_LOGIN", "admin")
ROLE_ADMIN = "admin"
ROLE_EMPLOYEE = "employee"
AUTH_TTL = timedelta(days=7)
ACCESS_PAGES = [
    {"key": "operations", "label": "Операционная работа", "path": "/operations"},
    {"key": "tasks", "label": "Трекер задач", "path": "/operations/tasks"},
    {"key": "knowledge", "label": "База знаний", "path": "/operations/knowledge"},
    {"key": "locations", "label": "Точки продаж", "path": "/locations"},
    {"key": "bloggers", "label": "Работа с блогерами", "path": "/bloggers"},
    {
        "key": "bloggers_settings",
        "label": "Настройки блогеров",
        "path": "/bloggers/settings",
    },
]
ACCESS_PAGE_KEYS = {page["key"] for page in ACCESS_PAGES}
ACCESS_PATHS = {page["path"]: page["key"] for page in ACCESS_PAGES}


def ensure_employee_access(conn, employee_id):
    for page in ACCESS_PAGES:
        conn.execute(
            """
            INSERT OR IGNORE INTO employee_access (employee_id, page, allowed)
            VALUES (?, ?, 1)
            """,
            (employee_id, page["key"]),
        )


def get_employee_access_for_conn(conn, employee_id):
    access_map = {page["key"]: True for page in ACCESS_PAGES}
    if not employee_id:
        return access_map
    ensure_employee_access(conn, employee_id)
    rows = conn.execute(
        "SELECT page, allowed FROM employee_access WHERE employee_id = ?",
        (employee_id,),
    ).fetchall()
    for row in rows:
        if row["page"] in access_map:
            access_map[row["page"]] = bool(row["allowed"])
    return access_map


def get_employee_access(employee_id):
    with get_db() as conn:
        return get_employee_access_for_conn(conn, employee_id)


def get_current_access():
    if get_role() == ROLE_ADMIN:
        return {page["key"]: True for page in ACCESS_PAGES}
    return get_employee_access(session.get("employee_id"))


def require_page_access(page_key, redirect_on_fail=True):
    if get_role() == ROLE_ADMIN:
        return None
    access_map = get_current_access()
    if access_map.get(page_key, True):
        return None
    if redirect_on_fail:
        return redirect("/no-access")
    return jsonify({"error": "forbidden"}), 403


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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS employees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                login TEXT,
                name TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS employee_access (
                employee_id INTEGER NOT NULL,
                page TEXT NOT NULL,
                allowed INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY(employee_id, page),
                FOREIGN KEY(employee_id) REFERENCES employees(id)
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
        employee_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(employees)").fetchall()
        }
        if "login" not in employee_columns:
            conn.execute("ALTER TABLE employees ADD COLUMN login TEXT")
        conn.execute(
            """
            UPDATE employees
            SET login = name
            WHERE login IS NULL OR TRIM(login) = ''
            """
        )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_login ON employees(login)"
        )
        employee_ids = conn.execute("SELECT id FROM employees").fetchall()
        for row in employee_ids:
            ensure_employee_access(conn, row["id"])


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
    open_paths = {"/login", "/api/login", "/api/logout"}
    protected_pages = {
        "/",
        "/locations",
        "/bloggers",
        "/operations",
        "/operations/tasks",
        "/operations/knowledge",
        "/settings",
        "/no-access",
    }
    if request.path.startswith("/static"):
        return None
    if session.get("authed") and not is_auth_fresh():
        session.clear()
    if request.path in open_paths:
        return None
    if request.path in protected_pages and not session.get("authed"):
        return redirect("/login")
    if not session.get("authed"):
        return jsonify({"error": "unauthorized"}), 401
    return None


def is_auth_fresh():
    last_auth = session.get("last_auth_at")
    if not last_auth:
        return False
    try:
        last_auth_time = datetime.fromisoformat(last_auth)
    except ValueError:
        return False
    return datetime.utcnow() - last_auth_time <= AUTH_TTL


def get_role():
    role = session.get("role")
    if role in {ROLE_ADMIN, ROLE_EMPLOYEE}:
        return role
    return ROLE_EMPLOYEE


def get_role_label(role):
    return "Админ" if role == ROLE_ADMIN else "Сотрудник"


def get_profile_name():
    if get_role() == ROLE_ADMIN:
        return "Админ"
    return session.get("employee_name") or "Сотрудник"


def get_profile_login():
    if get_role() == ROLE_ADMIN:
        return ADMIN_LOGIN
    return session.get("employee_login") or "employee"


def require_admin():
    if get_role() != ROLE_ADMIN:
        return jsonify({"error": "forbidden"}), 403
    return None


def hash_password(password):
    return sha256(password.encode("utf-8")).hexdigest()


def verify_password(password, password_hash):
    return hash_password(password) == password_hash


def resolve_shipment_status():
    return {
        "status": "Создано вручную",
        "location": None,
        "timestamp": datetime.utcnow().isoformat(),
        "code": "MANUAL",
    }


app.before_request(require_auth)


@app.route("/")
def index():
    if not session.get("authed"):
        return redirect("/login")
    role = get_role()
    access_map = get_current_access()
    return render_template(
        "index.html",
        authed=True,
        role=role,
        role_label=get_role_label(role),
        profile_name=get_profile_name(),
        access_map=access_map,
    )


@app.route("/login")
def login_page():
    if session.get("authed"):
        return redirect("/")
    return render_template("login.html")


@app.route("/locations")
def locations():
    if not session.get("authed"):
        return redirect("/")
    guard = require_page_access("locations")
    if guard:
        return guard
    role = get_role()
    return render_template(
        "locations.html",
        authed=True,
        role=role,
        role_label=get_role_label(role),
        profile_name=get_profile_name(),
    )


@app.route("/bloggers")
def bloggers():
    if not session.get("authed"):
        return redirect("/")
    guard = require_page_access("bloggers")
    if guard:
        return guard
    role = get_role()
    access_map = get_current_access()
    return render_template(
        "bloggers.html",
        authed=True,
        role=role,
        role_label=get_role_label(role),
        profile_name=get_profile_name(),
        profile_login=get_profile_login(),
        access_map=access_map,
    )


@app.route("/bloggers/integrations")
def bloggers_integrations():
    if not session.get("authed"):
        return redirect("/")
    guard = require_page_access("bloggers")
    if guard:
        return guard
    role = get_role()
    access_map = get_current_access()
    return render_template(
        "bloggers_integrations.html",
        authed=True,
        role=role,
        role_label=get_role_label(role),
        profile_name=get_profile_name(),
        profile_login=get_profile_login(),
        access_map=access_map,
    )


@app.route("/bloggers/base")
def bloggers_base():
    if not session.get("authed"):
        return redirect("/")
    guard = require_page_access("bloggers")
    if guard:
        return guard
    role = get_role()
    access_map = get_current_access()
    return render_template(
        "bloggers_base.html",
        authed=True,
        role=role,
        role_label=get_role_label(role),
        profile_name=get_profile_name(),
        profile_login=get_profile_login(),
        access_map=access_map,
    )


@app.route("/bloggers/settings")
def bloggers_settings():
    if not session.get("authed"):
        return redirect("/")
    guard = require_page_access("bloggers_settings")
    if guard:
        return guard
    role = get_role()
    access_map = get_current_access()
    return render_template(
        "bloggers_settings.html",
        authed=True,
        role=role,
        role_label=get_role_label(role),
        profile_name=get_profile_name(),
        profile_login=get_profile_login(),
        access_map=access_map,
    )


@app.route("/operations")
def operations():
    if not session.get("authed"):
        return redirect("/")
    guard = require_page_access("operations")
    if guard:
        return guard
    role = get_role()
    access_map = get_current_access()
    return render_template(
        "operations.html",
        authed=True,
        role=role,
        role_label=get_role_label(role),
        profile_name=get_profile_name(),
        access_map=access_map,
    )


@app.route("/operations/tasks")
def operations_tasks():
    if not session.get("authed"):
        return redirect("/")
    guard = require_page_access("tasks")
    if guard:
        return guard
    role = get_role()
    return render_template(
        "tasks.html",
        authed=True,
        role=role,
        role_label=get_role_label(role),
        profile_name=get_profile_name(),
    )


@app.route("/operations/knowledge")
def operations_knowledge():
    if not session.get("authed"):
        return redirect("/")
    guard = require_page_access("knowledge")
    if guard:
        return guard
    role = get_role()
    return render_template(
        "knowledge.html",
        authed=True,
        role=role,
        role_label=get_role_label(role),
        profile_name=get_profile_name(),
    )


@app.route("/settings")
def settings():
    if not session.get("authed"):
        return redirect("/")
    if get_role() != ROLE_ADMIN:
        return redirect("/")
    role = get_role()
    return render_template(
        "settings.html",
        authed=True,
        role=role,
        role_label=get_role_label(role),
        profile_name=get_profile_name(),
        access_pages=ACCESS_PAGES,
    )


@app.route("/no-access")
def no_access():
    if not session.get("authed"):
        return redirect("/login")
    return render_template("no_access.html")


@app.post("/api/login")
def login():
    payload = request.get_json() or {}
    login_name = (payload.get("login") or "").strip()
    password = (payload.get("password") or "").strip()
    if not login_name or not password:
        return jsonify({"ok": False, "error": "Введите логин и пароль"}), 400
    if login_name == ADMIN_LOGIN:
        if password == PASSWORD:
            session["authed"] = True
            session["role"] = ROLE_ADMIN
            session["employee_id"] = None
            session["employee_name"] = None
            session["employee_login"] = ADMIN_LOGIN
            session["last_auth_at"] = datetime.utcnow().isoformat()
            return jsonify({"ok": True, "role": ROLE_ADMIN})
        return jsonify({"ok": False, "error": "Неверный пароль"}), 401

    with get_db() as conn:
        row = conn.execute(
            "SELECT id, login, name, password_hash FROM employees WHERE login = ?",
            (login_name,),
        ).fetchone()
    if not row or not verify_password(password, row["password_hash"]):
        return jsonify({"ok": False, "error": "Неверный пароль"}), 401
    session["authed"] = True
    session["role"] = ROLE_EMPLOYEE
    session["employee_id"] = row["id"]
    session["employee_name"] = row["name"]
    session["employee_login"] = row["login"]
    session["last_auth_at"] = datetime.utcnow().isoformat()
    return jsonify({"ok": True, "role": ROLE_EMPLOYEE, "employee": row["name"]})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/employees")
def list_employees():
    if get_role() != ROLE_ADMIN:
        return jsonify({"error": "forbidden"}), 403
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, login, name, created_at FROM employees ORDER BY created_at DESC"
        ).fetchall()
    employees = []
    with get_db() as conn:
        for row in rows:
            employee = dict(row)
            employee["access"] = get_employee_access_for_conn(conn, row["id"])
            employees.append(employee)
    return jsonify(employees)


@app.post("/api/employees")
def create_employee():
    guard = require_admin()
    if guard:
        return guard
    payload = request.get_json() or {}
    login = (payload.get("login") or "").strip()
    name = (payload.get("name") or "").strip()
    password = (payload.get("password") or "").strip()
    if not login or not name or not password:
        return jsonify({"error": "Заполните логин, имя и пароль"}), 400
    password_hash = hash_password(password)
    created_at = datetime.utcnow().isoformat()
    try:
        with get_db() as conn:
            cursor = conn.execute(
                """
                INSERT INTO employees (login, name, password_hash, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (login, name, password_hash, created_at),
            )
            ensure_employee_access(conn, cursor.lastrowid)
    except sqlite3.IntegrityError:
        return jsonify({"error": "Профиль с таким логином уже существует"}), 400
    return jsonify({"ok": True})


@app.post("/api/employees/<int:employee_id>/access")
def update_employee_access(employee_id):
    guard = require_admin()
    if guard:
        return guard
    payload = request.get_json() or {}
    page = payload.get("page")
    allowed = payload.get("allowed")
    access = payload.get("access")
    updates = {}
    if isinstance(access, dict):
        updates = access
    elif page:
        updates = {page: allowed}
    if not updates:
        return jsonify({"error": "Нет данных для обновления"}), 400
    invalid = [key for key in updates.keys() if key not in ACCESS_PAGE_KEYS]
    if invalid:
        return jsonify({"error": "Неизвестная страница доступа"}), 400
    with get_db() as conn:
        ensure_employee_access(conn, employee_id)
        for key, value in updates.items():
            conn.execute(
                """
                INSERT INTO employee_access (employee_id, page, allowed)
                VALUES (?, ?, ?)
                ON CONFLICT(employee_id, page)
                DO UPDATE SET allowed = excluded.allowed
                """,
                (employee_id, key, 1 if value else 0),
            )
        access_map = get_employee_access_for_conn(conn, employee_id)
    return jsonify({"ok": True, "access": access_map})


@app.post("/api/employees/<int:employee_id>/password")
def update_employee_password(employee_id):
    guard = require_admin()
    if guard:
        return guard
    payload = request.get_json() or {}
    password = (payload.get("password") or "").strip()
    if not password:
        return jsonify({"error": "Введите новый пароль"}), 400
    password_hash = hash_password(password)
    with get_db() as conn:
        result = conn.execute(
            "UPDATE employees SET password_hash = ? WHERE id = ?",
            (password_hash, employee_id),
        )
    if result.rowcount == 0:
        return jsonify({"error": "Профиль не найден"}), 404
    return jsonify({"ok": True})


@app.delete("/api/employees/<int:employee_id>")
def delete_employee(employee_id):
    guard = require_admin()
    if guard:
        return guard
    with get_db() as conn:
        result = conn.execute("DELETE FROM employees WHERE id = ?", (employee_id,))
    if result.rowcount == 0:
        return jsonify({"error": "Профиль не найден"}), 404
    return jsonify({"ok": True})


@app.get("/api/locations")
def get_locations():
    guard = require_page_access("locations", redirect_on_fail=False)
    if guard:
        return guard
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
    guard = require_page_access("locations", redirect_on_fail=False)
    if guard:
        return guard
    guard = require_admin()
    if guard:
        return guard
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
    guard = require_page_access("locations", redirect_on_fail=False)
    if guard:
        return guard
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
    guard = require_page_access("locations", redirect_on_fail=False)
    if guard:
        return guard
    guard = require_admin()
    if guard:
        return guard
    with get_db() as conn:
        conn.execute("DELETE FROM records WHERE location_id = ?", (location_id,))
        result = conn.execute("DELETE FROM locations WHERE id = ?", (location_id,))
        if result.rowcount == 0:
            return jsonify({"error": "Точка продаж не найдена"}), 404
    return jsonify({"ok": True})


@app.post("/api/upload")
def upload_file():
    guard = require_page_access("locations", redirect_on_fail=False)
    if guard:
        return guard
    guard = require_admin()
    if guard:
        return guard
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
    guard = require_page_access("locations", redirect_on_fail=False)
    if guard:
        return guard
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
    guard = require_page_access("locations", redirect_on_fail=False)
    if guard:
        return guard
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
    guard = require_page_access("locations", redirect_on_fail=False)
    if guard:
        return guard
    guard = require_admin()
    if guard:
        return guard
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
    status_data = resolve_shipment_status()
    cdek_state = status_data.get("code") or "MANUAL"
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




@app.delete("/api/shipments/<int:shipment_id>")
def delete_shipment(shipment_id):
    guard = require_page_access("locations", redirect_on_fail=False)
    if guard:
        return guard
    guard = require_admin()
    if guard:
        return guard
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
