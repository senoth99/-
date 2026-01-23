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
    {"key": "training", "label": "Обучение", "path": "/training"},
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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                status TEXT NOT NULL,
                priority TEXT NOT NULL,
                assignee TEXT,
                deadline TEXT,
                created_by_name TEXT,
                created_by_login TEXT,
                created_by_role TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS knowledge_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                section TEXT,
                owner TEXT,
                tag TEXT,
                created_by_name TEXT,
                created_by_login TEXT,
                created_by_role TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS profiles (
                login TEXT PRIMARY KEY,
                avatar_url TEXT,
                xp INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                category TEXT,
                level TEXT,
                duration TEXT,
                xp_value INTEGER NOT NULL DEFAULT 0,
                is_public INTEGER NOT NULL DEFAULT 1,
                outline_json TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS course_access (
                course_id INTEGER NOT NULL,
                login TEXT NOT NULL,
                allowed INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY(course_id, login),
                FOREIGN KEY(course_id) REFERENCES courses(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS course_progress (
                course_id INTEGER NOT NULL,
                login TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'not_started',
                current_topic TEXT,
                current_lesson TEXT,
                current_test TEXT,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                PRIMARY KEY(course_id, login),
                FOREIGN KEY(course_id) REFERENCES courses(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS course_badges (
                course_id INTEGER NOT NULL,
                login TEXT NOT NULL,
                badge_label TEXT NOT NULL,
                xp_awarded INTEGER NOT NULL DEFAULT 0,
                awarded_at TEXT NOT NULL,
                PRIMARY KEY(course_id, login),
                FOREIGN KEY(course_id) REFERENCES courses(id)
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
        profile_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(profiles)").fetchall()
        }
        if "avatar_url" not in profile_columns:
            conn.execute("ALTER TABLE profiles ADD COLUMN avatar_url TEXT")
        if "xp" not in profile_columns:
            conn.execute("ALTER TABLE profiles ADD COLUMN xp INTEGER NOT NULL DEFAULT 0")
        if "updated_at" not in profile_columns:
            conn.execute("ALTER TABLE profiles ADD COLUMN updated_at TEXT")
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
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_course_access_login ON course_access(login)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_course_progress_login ON course_progress(login)"
        )
        employee_ids = conn.execute("SELECT id FROM employees").fetchall()
        for row in employee_ids:
            ensure_employee_access(conn, row["id"])
        employee_logins = conn.execute("SELECT login FROM employees").fetchall()
        for row in employee_logins:
            if row["login"]:
                ensure_profile(conn, row["login"])
        ensure_profile(conn, ADMIN_LOGIN)


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
        "/training",
        "/training/settings",
        "/profile",
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


def ensure_profile(conn, login):
    now = datetime.utcnow().isoformat()
    conn.execute(
        """
        INSERT OR IGNORE INTO profiles (login, avatar_url, xp, updated_at)
        VALUES (?, ?, ?, ?)
        """,
        (login, "", 0, now),
    )


def get_profile_data(conn, login):
    ensure_profile(conn, login)
    row = conn.execute(
        "SELECT login, avatar_url, xp FROM profiles WHERE login = ?",
        (login,),
    ).fetchone()
    return dict(row) if row else {"login": login, "avatar_url": "", "xp": 0}


def get_employee_name_by_login(conn, login):
    if login == ADMIN_LOGIN:
        return "Админ"
    row = conn.execute("SELECT name FROM employees WHERE login = ?", (login,)).fetchone()
    if row:
        return row["name"]
    return login


def get_course_outline_summary(outline):
    topics = outline or []
    topic_count = len(topics)
    lesson_count = 0
    test_count = 0
    for topic in topics:
        lesson_count += len(topic.get("lessons", []) or [])
        test_count += len(topic.get("tests", []) or [])
    return {
        "topics": topic_count,
        "lessons": lesson_count,
        "tests": test_count,
    }


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


def get_actor_snapshot():
    return {
        "name": get_profile_name(),
        "login": get_profile_login(),
        "role": get_role(),
    }


def can_manage_record(owner_login):
    if get_role() == ROLE_ADMIN:
        return True
    if not owner_login:
        return False
    return owner_login == get_profile_login()


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


@app.route("/training")
def training():
    if not session.get("authed"):
        return redirect("/")
    guard = require_page_access("training")
    if guard:
        return guard
    role = get_role()
    access_map = get_current_access()
    return render_template(
        "training.html",
        authed=True,
        role=role,
        role_label=get_role_label(role),
        profile_name=get_profile_name(),
        profile_login=get_profile_login(),
        access_map=access_map,
    )


@app.route("/training/courses")
def training_courses():
    if not session.get("authed"):
        return redirect("/")
    guard = require_page_access("training")
    if guard:
        return guard
    role = get_role()
    return render_template(
        "training_courses.html",
        authed=True,
        role=role,
        role_label=get_role_label(role),
        profile_name=get_profile_name(),
    )


@app.route("/training/settings")
def training_settings():
    if not session.get("authed"):
        return redirect("/")
    if get_role() != ROLE_ADMIN:
        return redirect("/training")
    role = get_role()
    return render_template(
        "training_settings.html",
        authed=True,
        role=role,
        role_label=get_role_label(role),
        profile_name=get_profile_name(),
    )


@app.route("/profile")
def profile():
    if not session.get("authed"):
        return redirect("/")
    role = get_role()
    return render_template(
        "profile.html",
        authed=True,
        role=role,
        role_label=get_role_label(role),
        profile_name=get_profile_name(),
        profile_login=get_profile_login(),
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
            with get_db() as conn:
                ensure_profile(conn, ADMIN_LOGIN)
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
    with get_db() as conn:
        ensure_profile(conn, row["login"])
    return jsonify({"ok": True, "role": ROLE_EMPLOYEE, "employee": row["name"]})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/employees")
def list_employees():
    public_view = request.args.get("public") == "true"
    if get_role() != ROLE_ADMIN and not public_view:
        return jsonify({"error": "forbidden"}), 403
    with get_db() as conn:
        if public_view:
            rows = conn.execute(
                "SELECT id, name FROM employees ORDER BY created_at DESC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, login, name, created_at FROM employees ORDER BY created_at DESC"
            ).fetchall()
    if public_view:
        return jsonify([dict(row) for row in rows])
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
            ensure_profile(conn, login)
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


@app.get("/api/profile")
def get_profile():
    login = get_profile_login()
    with get_db() as conn:
        profile = get_profile_data(conn, login)
        badges = conn.execute(
            """
            SELECT course_badges.course_id, course_badges.badge_label,
                   course_badges.xp_awarded, course_badges.awarded_at,
                   courses.title AS course_title
            FROM course_badges
            LEFT JOIN courses ON courses.id = course_badges.course_id
            WHERE course_badges.login = ?
            ORDER BY course_badges.awarded_at DESC
            """,
            (login,),
        ).fetchall()
    profile["name"] = get_profile_name()
    profile["role"] = get_role()
    return jsonify(
        {
            "profile": profile,
            "badges": [dict(row) for row in badges],
        }
    )


@app.post("/api/profile/avatar")
def update_profile_avatar():
    payload = request.get_json() or {}
    avatar_url = (payload.get("avatar_url") or "").strip()
    if avatar_url and not re.match(r"^https?://", avatar_url):
        return jsonify({"error": "Используйте ссылку на внешний ресурс"}), 400
    login = get_profile_login()
    with get_db() as conn:
        ensure_profile(conn, login)
        conn.execute(
            """
            UPDATE profiles
            SET avatar_url = ?, updated_at = ?
            WHERE login = ?
            """,
            (avatar_url, datetime.utcnow().isoformat(), login),
        )
    return jsonify({"ok": True})


def award_course_completion(conn, course, login):
    existing = conn.execute(
        """
        SELECT course_id FROM course_badges WHERE course_id = ? AND login = ?
        """,
        (course["id"], login),
    ).fetchone()
    if existing:
        return
    badge_label = f"Курс: {course['title']}"
    awarded_at = datetime.utcnow().isoformat()
    xp_value = int(course["xp_value"] or 0)
    conn.execute(
        """
        INSERT INTO course_badges (course_id, login, badge_label, xp_awarded, awarded_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (course["id"], login, badge_label, xp_value, awarded_at),
    )
    profile = get_profile_data(conn, login)
    conn.execute(
        """
        UPDATE profiles
        SET xp = ?, updated_at = ?
        WHERE login = ?
        """,
        (int(profile["xp"]) + xp_value, awarded_at, login),
    )


def resolve_outline(outline_json):
    if not outline_json:
        return []
    try:
        data = json.loads(outline_json)
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        return []
    return []


def list_course_access(conn, login):
    rows = conn.execute(
        "SELECT course_id, allowed FROM course_access WHERE login = ?",
        (login,),
    ).fetchall()
    return {row["course_id"]: bool(row["allowed"]) for row in rows}


def list_course_progress(conn, login):
    rows = conn.execute(
        """
        SELECT course_id, status, current_topic, current_lesson, current_test,
               updated_at, completed_at
        FROM course_progress
        WHERE login = ?
        """,
        (login,),
    ).fetchall()
    return {row["course_id"]: dict(row) for row in rows}


@app.get("/api/training/overview")
def training_overview():
    guard = require_page_access("training", redirect_on_fail=False)
    if guard:
        return guard
    login = get_profile_login()
    role = get_role()
    with get_db() as conn:
        profile = get_profile_data(conn, login)
        badges = conn.execute(
            """
            SELECT course_badges.course_id, course_badges.badge_label,
                   course_badges.xp_awarded, course_badges.awarded_at,
                   courses.title AS course_title
            FROM course_badges
            LEFT JOIN courses ON courses.id = course_badges.course_id
            WHERE course_badges.login = ?
            ORDER BY course_badges.awarded_at DESC
            """,
            (login,),
        ).fetchall()
        course_rows = conn.execute(
            """
            SELECT id, title, description, category, level, duration, xp_value,
                   is_public, outline_json, created_at
            FROM courses
            ORDER BY created_at DESC
            """
        ).fetchall()
        access_map = list_course_access(conn, login)
        progress_map = list_course_progress(conn, login)
    courses = []
    categories = set()
    for row in course_rows:
        outline = resolve_outline(row["outline_json"])
        summary = get_course_outline_summary(outline)
        is_public = bool(row["is_public"])
        if role == ROLE_ADMIN:
            accessible = True
        else:
            accessible = True if is_public else access_map.get(row["id"], False)
        progress = progress_map.get(row["id"])
        status = progress["status"] if progress else "not_started"
        courses.append(
            {
                "id": row["id"],
                "title": row["title"],
                "description": row["description"],
                "category": row["category"],
                "level": row["level"],
                "duration": row["duration"],
                "xp_value": row["xp_value"],
                "is_public": is_public,
                "outline": outline,
                "summary": summary,
                "accessible": accessible,
                "status": status,
                "progress": progress or {},
            }
        )
        if row["category"]:
            categories.add(row["category"])
    profile["name"] = get_profile_name()
    profile["role"] = role
    return jsonify(
        {
            "profile": profile,
            "badges": [dict(row) for row in badges],
            "courses": courses,
            "categories": sorted(categories),
        }
    )


@app.post("/api/training/courses")
def create_course():
    guard = require_admin()
    if guard:
        return guard
    payload = request.get_json() or {}
    title = (payload.get("title") or "").strip()
    description = (payload.get("description") or "").strip()
    category = (payload.get("category") or "").strip()
    level = (payload.get("level") or "").strip()
    duration = (payload.get("duration") or "").strip()
    xp_value = payload.get("xp_value") or 0
    is_public = bool(payload.get("is_public", True))
    outline = payload.get("outline") or []
    if not title:
        return jsonify({"error": "Введите название курса"}), 400
    try:
        xp_value = int(xp_value)
    except (TypeError, ValueError):
        xp_value = 0
    created_at = datetime.utcnow().isoformat()
    outline_json = json.dumps(outline, ensure_ascii=False)
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO courses
            (title, description, category, level, duration, xp_value, is_public,
             outline_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                title,
                description,
                category,
                level,
                duration,
                xp_value,
                1 if is_public else 0,
                outline_json,
                created_at,
            ),
        )
    return jsonify({"ok": True})


@app.delete("/api/training/courses/<int:course_id>")
def delete_course(course_id):
    guard = require_admin()
    if guard:
        return guard
    with get_db() as conn:
        conn.execute("DELETE FROM course_access WHERE course_id = ?", (course_id,))
        conn.execute("DELETE FROM course_progress WHERE course_id = ?", (course_id,))
        conn.execute("DELETE FROM course_badges WHERE course_id = ?", (course_id,))
        result = conn.execute("DELETE FROM courses WHERE id = ?", (course_id,))
    if result.rowcount == 0:
        return jsonify({"error": "Курс не найден"}), 404
    return jsonify({"ok": True})


@app.post("/api/training/courses/<int:course_id>/access")
def update_course_access(course_id):
    guard = require_admin()
    if guard:
        return guard
    payload = request.get_json() or {}
    access = payload.get("access")
    login = payload.get("login")
    allowed = payload.get("allowed")
    updates = {}
    if isinstance(access, dict):
        updates = access
    elif login:
        updates = {login: allowed}
    if not updates:
        return jsonify({"error": "Нет данных для обновления"}), 400
    with get_db() as conn:
        for login_key, value in updates.items():
            conn.execute(
                """
                INSERT INTO course_access (course_id, login, allowed)
                VALUES (?, ?, ?)
                ON CONFLICT(course_id, login)
                DO UPDATE SET allowed = excluded.allowed
                """,
                (course_id, login_key, 1 if value else 0),
            )
    return jsonify({"ok": True})


@app.post("/api/training/courses/<int:course_id>/progress")
def update_course_progress(course_id):
    guard = require_admin()
    if guard:
        return guard
    payload = request.get_json() or {}
    login = (payload.get("login") or "").strip()
    status = (payload.get("status") or "not_started").strip()
    current_topic = (payload.get("current_topic") or "").strip()
    current_lesson = (payload.get("current_lesson") or "").strip()
    current_test = (payload.get("current_test") or "").strip()
    if not login:
        return jsonify({"error": "Укажите сотрудника"}), 400
    if status not in {"not_started", "in_progress", "completed"}:
        return jsonify({"error": "Некорректный статус"}), 400
    updated_at = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO course_progress
            (course_id, login, status, current_topic, current_lesson, current_test,
             updated_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(course_id, login)
            DO UPDATE SET status = excluded.status,
                          current_topic = excluded.current_topic,
                          current_lesson = excluded.current_lesson,
                          current_test = excluded.current_test,
                          updated_at = excluded.updated_at,
                          completed_at = excluded.completed_at
            """,
            (
                course_id,
                login,
                status,
                current_topic or None,
                current_lesson or None,
                current_test or None,
                updated_at,
                updated_at if status == "completed" else None,
            ),
        )
        course = conn.execute(
            "SELECT id, title, xp_value FROM courses WHERE id = ?",
            (course_id,),
        ).fetchone()
        if course and status == "completed":
            award_course_completion(conn, course, login)
    return jsonify({"ok": True})


@app.post("/api/training/courses/<int:course_id>/complete")
def complete_course(course_id):
    guard = require_page_access("training", redirect_on_fail=False)
    if guard:
        return guard
    login = get_profile_login()
    role = get_role()
    with get_db() as conn:
        course = conn.execute(
            """
            SELECT id, title, is_public, xp_value
            FROM courses
            WHERE id = ?
            """,
            (course_id,),
        ).fetchone()
        if not course:
            return jsonify({"error": "Курс не найден"}), 404
        if role != ROLE_ADMIN and not course["is_public"]:
            access = conn.execute(
                """
                SELECT allowed FROM course_access
                WHERE course_id = ? AND login = ?
                """,
                (course_id, login),
            ).fetchone()
            if not access or not access["allowed"]:
                return jsonify({"error": "Нет доступа к курсу"}), 403
        updated_at = datetime.utcnow().isoformat()
        conn.execute(
            """
            INSERT INTO course_progress
            (course_id, login, status, updated_at, completed_at)
            VALUES (?, ?, 'completed', ?, ?)
            ON CONFLICT(course_id, login)
            DO UPDATE SET status = 'completed',
                          updated_at = excluded.updated_at,
                          completed_at = excluded.completed_at
            """,
            (course_id, login, updated_at, updated_at),
        )
        award_course_completion(conn, course, login)
        profile = get_profile_data(conn, login)
    return jsonify({"ok": True, "xp": profile["xp"]})


@app.get("/api/training/admin-data")
def training_admin_data():
    guard = require_admin()
    if guard:
        return guard
    with get_db() as conn:
        employees = conn.execute(
            """
            SELECT login, name
            FROM employees
            ORDER BY name
            """
        ).fetchall()
        profiles = conn.execute(
            """
            SELECT login, avatar_url, xp
            FROM profiles
            """
        ).fetchall()
        courses = conn.execute(
            """
            SELECT id, title, description, category, level, duration, xp_value,
                   is_public, outline_json, created_at
            FROM courses
            ORDER BY created_at DESC
            """
        ).fetchall()
        access_rows = conn.execute(
            "SELECT course_id, login, allowed FROM course_access"
        ).fetchall()
        progress_rows = conn.execute(
            """
            SELECT course_id, login, status, current_topic, current_lesson,
                   current_test, updated_at, completed_at
            FROM course_progress
            """
        ).fetchall()
    profile_map = {row["login"]: dict(row) for row in profiles}
    access_map = {}
    for row in access_rows:
        access_map.setdefault(row["course_id"], {})[row["login"]] = bool(row["allowed"])
    progress_map = {}
    for row in progress_rows:
        progress_map.setdefault(row["course_id"], {})[row["login"]] = dict(row)
    employees_data = []
    for row in employees:
        profile = profile_map.get(row["login"], {"avatar_url": "", "xp": 0})
        employees_data.append(
            {
                "login": row["login"],
                "name": row["name"],
                "avatar_url": profile.get("avatar_url", ""),
                "xp": profile.get("xp", 0),
            }
        )
    courses_data = []
    for row in courses:
        outline = resolve_outline(row["outline_json"])
        courses_data.append(
            {
                "id": row["id"],
                "title": row["title"],
                "description": row["description"],
                "category": row["category"],
                "level": row["level"],
                "duration": row["duration"],
                "xp_value": row["xp_value"],
                "is_public": bool(row["is_public"]),
                "outline": outline,
                "summary": get_course_outline_summary(outline),
                "access": access_map.get(row["id"], {}),
                "progress": progress_map.get(row["id"], {}),
            }
        )
    return jsonify({"employees": employees_data, "courses": courses_data})


@app.get("/api/tasks")
def list_tasks():
    guard = require_page_access("tasks", redirect_on_fail=False)
    if guard:
        return guard
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, title, status, priority, assignee, deadline,
                   created_by_name, created_by_login, created_by_role,
                   created_at, updated_at
            FROM tasks
            ORDER BY updated_at DESC
            """
        ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/tasks")
def create_task():
    guard = require_page_access("tasks", redirect_on_fail=False)
    if guard:
        return guard
    payload = request.get_json() or {}
    title = (payload.get("title") or "").strip()
    status = (payload.get("status") or "").strip()
    priority = (payload.get("priority") or "").strip()
    assignee = (payload.get("assignee") or "").strip()
    deadline = (payload.get("deadline") or "").strip() or None
    if not title or not status or not priority:
        return jsonify({"error": "Заполните название, статус и приоритет"}), 400
    created_at = datetime.utcnow().isoformat()
    actor = get_actor_snapshot()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO tasks
            (title, status, priority, assignee, deadline,
             created_by_name, created_by_login, created_by_role, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                title,
                status,
                priority,
                assignee,
                deadline,
                actor["name"],
                actor["login"],
                actor["role"],
                created_at,
                created_at,
            ),
        )
    return jsonify({"ok": True})


@app.delete("/api/tasks/<int:task_id>")
def delete_task(task_id):
    guard = require_page_access("tasks", redirect_on_fail=False)
    if guard:
        return guard
    with get_db() as conn:
        row = conn.execute(
            "SELECT created_by_login FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if not row:
            return jsonify({"error": "Задача не найдена"}), 404
        if not can_manage_record(row["created_by_login"]):
            return jsonify({"error": "forbidden"}), 403
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    return jsonify({"ok": True})


@app.get("/api/knowledge")
def list_knowledge():
    guard = require_page_access("knowledge", redirect_on_fail=False)
    if guard:
        return guard
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, title, section, owner, tag,
                   created_by_name, created_by_login, created_by_role,
                   created_at, updated_at
            FROM knowledge_items
            ORDER BY updated_at DESC
            """
        ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/knowledge")
def create_knowledge():
    guard = require_page_access("knowledge", redirect_on_fail=False)
    if guard:
        return guard
    payload = request.get_json() or {}
    title = (payload.get("title") or "").strip()
    section = (payload.get("section") or "").strip()
    owner = (payload.get("owner") or "").strip()
    tag = (payload.get("tag") or "").strip()
    if not title:
        return jsonify({"error": "Заполните название документа"}), 400
    created_at = datetime.utcnow().isoformat()
    actor = get_actor_snapshot()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO knowledge_items
            (title, section, owner, tag,
             created_by_name, created_by_login, created_by_role, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                title,
                section,
                owner,
                tag,
                actor["name"],
                actor["login"],
                actor["role"],
                created_at,
                created_at,
            ),
        )
    return jsonify({"ok": True})


@app.delete("/api/knowledge/<int:item_id>")
def delete_knowledge(item_id):
    guard = require_page_access("knowledge", redirect_on_fail=False)
    if guard:
        return guard
    with get_db() as conn:
        row = conn.execute(
            "SELECT created_by_login FROM knowledge_items WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not row:
            return jsonify({"error": "Документ не найден"}), 404
        if not can_manage_record(row["created_by_login"]):
            return jsonify({"error": "forbidden"}), 403
        conn.execute("DELETE FROM knowledge_items WHERE id = ?", (item_id,))
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
