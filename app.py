import os
import re
import sqlite3
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timedelta

import pandas as pd
from flask import Flask, jsonify, render_template, request, send_file, session
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright
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
CDEK_TRACKING_URL = "https://lk.cdek.ru/order-history/trace?orderNumber={track_number}"
CDEK_TRACKING_CACHE_TTL = timedelta(minutes=8)
CDEK_TRACKING_MIN_INTERVAL = timedelta(seconds=4)
CDEK_TRACKING_SELECTORS = {
    "order_number": [
        "[data-test='order-number']",
        ".order-number",
        ".order__number",
        "h1",
        "h2",
    ],
    "route": [
        "[data-test='route']",
        ".order-route",
        ".order__route",
        ".tracking-route",
    ],
    "from_city": [
        "[data-test='from-city']",
        ".order-route__from",
        ".route__from",
    ],
    "to_city": [
        "[data-test='to-city']",
        ".order-route__to",
        ".route__to",
    ],
    "timeline_items": [
        ".order-status__item",
        ".tracking-timeline__item",
        ".timeline__item",
        ".status-timeline__item",
        "li[data-test='timeline-item']",
    ],
    "timeline_title": [
        ".order-status__title",
        ".timeline__title",
        ".status__title",
        ".tracking-step__title",
    ],
    "timeline_date": [
        ".order-status__date",
        ".timeline__date",
        ".status__date",
        "time",
    ],
    "timeline_city": [
        ".order-status__city",
        ".timeline__city",
        ".status__city",
        ".tracking-step__city",
    ],
    "timeline_active": [
        ".is-active",
        ".active",
        "[data-active='true']",
        "[aria-current='step']",
    ],
    "current_status": [
        ".tracking-current__status",
        ".order-status__current",
        ".current-status",
    ],
    "current_city": [
        ".tracking-current__city",
        ".order-status__location",
        ".current-city",
    ],
}

TRACKING_JSON_HINTS = {
    "status": {"status", "state", "status_name", "statusName", "statusTitle"},
    "events": {"events", "history", "statuses", "timeline", "steps", "operations"},
    "city": {"city", "city_name", "cityName", "location", "location_name", "locationName"},
    "from_city": {"from_city", "sender_city", "origin_city", "city_from", "fromCity"},
    "to_city": {"to_city", "receiver_city", "destination_city", "city_to", "toCity"},
    "number": {"order_number", "orderNumber", "track_number", "trackingNumber", "number"},
}

_CDEK_TRACKING_CACHE = {}
_CDEK_TRACKING_LAST_FETCH = {}
_CDEK_TRACKING_LAST_GLOBAL_FETCH = None


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


@dataclass
class TrackingCandidate:
    score: int
    payload: dict


def _normalize_text(value):
    if not value:
        return ""
    return " ".join(str(value).split())


def _parse_iso_date(value):
    if not value:
        return None
    raw = _normalize_text(value)
    if "T" in raw:
        cleaned = raw.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(cleaned)
            return parsed.date().isoformat()
        except ValueError:
            return None
    return None


def _normalize_city_value(value):
    if not value:
        return None
    if isinstance(value, dict):
        for key in TRACKING_JSON_HINTS["city"]:
            if key in value and value[key]:
                return _normalize_text(value[key])
        if "name" in value:
            return _normalize_text(value["name"])
    return _normalize_text(value)


def _extract_from_to(payload):
    from_city = None
    to_city = None
    for key in TRACKING_JSON_HINTS["from_city"]:
        if key in payload:
            from_city = _normalize_city_value(payload.get(key))
            break
    for key in TRACKING_JSON_HINTS["to_city"]:
        if key in payload:
            to_city = _normalize_city_value(payload.get(key))
            break
    if not from_city and isinstance(payload.get("from"), dict):
        from_city = _normalize_city_value(payload["from"].get("city") or payload["from"].get("name"))
    if not to_city and isinstance(payload.get("to"), dict):
        to_city = _normalize_city_value(payload["to"].get("city") or payload["to"].get("name"))
    return from_city, to_city


def _parse_tracking_events(events_payload):
    events = []
    if not isinstance(events_payload, list):
        return events
    for idx, item in enumerate(events_payload):
        if not isinstance(item, dict):
            continue
        title = None
        for key in ("title", "status", "status_name", "statusName", "state", "name", "description"):
            if item.get(key):
                title = _normalize_text(item.get(key))
                break
        date_raw = (
            item.get("date_time")
            or item.get("dateTime")
            or item.get("date")
            or item.get("timestamp")
            or item.get("created_at")
            or item.get("createdAt")
        )
        parsed_date = _parse_iso_date(date_raw) or _parse_date(date_raw)
        city = _normalize_city_value(
            item.get("city")
            or item.get("city_name")
            or item.get("location")
            or item.get("location_name")
        )
        if not title and not parsed_date and not city:
            continue
        events.append(
            {
                "code": _status_code_from_title(title, idx) if title else f"status_{idx + 1}",
                "title": title or "—",
                "date": parsed_date,
                "city": city or "—",
            }
        )
    return events


def _collect_tracking_candidates(payload):
    candidates = []
    stack = [payload]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            keys = set(node.keys())
            score = 0
            if keys & TRACKING_JSON_HINTS["events"]:
                score += 2
            if keys & TRACKING_JSON_HINTS["status"]:
                score += 2
            if keys & TRACKING_JSON_HINTS["city"]:
                score += 1
            if score:
                candidates.append(TrackingCandidate(score=score, payload=node))
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    return sorted(candidates, key=lambda item: item.score, reverse=True)


def _parse_tracking_payload(payload, track_number):
    if not isinstance(payload, (dict, list)):
        return None
    candidates = _collect_tracking_candidates(payload)
    for candidate in candidates:
        data = candidate.payload
        events_payload = None
        for key in TRACKING_JSON_HINTS["events"]:
            if key in data:
                events_payload = data.get(key)
                break
        events = _parse_tracking_events(events_payload)
        if not events:
            continue
        status_value = None
        for key in TRACKING_JSON_HINTS["status"]:
            if key in data and data.get(key):
                status_value = _normalize_text(data.get(key))
                break
        from_city, to_city = _extract_from_to(data)
        current_city = _normalize_city_value(data.get("city") or data.get("location"))
        if not current_city:
            current_city = events[-1].get("city")
        current_status = status_value or events[-1].get("title")
        if not (current_status or current_city):
            continue
        order_number = None
        for key in TRACKING_JSON_HINTS["number"]:
            if key in data and data.get(key):
                order_number = _normalize_text(data.get(key))
                break
        return {
            "track_number": track_number,
            "order_number": order_number or track_number,
            "status": current_status,
            "current_city": current_city,
            "from_city": from_city,
            "to_city": to_city,
            "events": events,
        }
    return None


def _extract_first_text(target, selectors):
    for selector in selectors:
        try:
            locator = target.locator(selector)
            if locator.count() > 0:
                text = locator.first.text_content()
                normalized = _normalize_text(text)
                if normalized:
                    return normalized
        except Exception:
            continue
    return ""


def _parse_date(value):
    if not value:
        return None
    raw = _normalize_text(value)
    match = re.search(r"(\\d{2})[./-](\\d{2})[./-](\\d{4})", raw)
    if match:
        day, month, year = match.groups()
        return f"{year}-{month}-{day}"
    match = re.search(r"(\\d{2})[./-](\\d{2})", raw)
    if match:
        day, month = match.groups()
        return f"{datetime.utcnow().year}-{month}-{day}"
    months = {
        "января": 1,
        "февраля": 2,
        "марта": 3,
        "апреля": 4,
        "мая": 5,
        "июня": 6,
        "июля": 7,
        "августа": 8,
        "сентября": 9,
        "октября": 10,
        "ноября": 11,
        "декабря": 12,
    }
    match = re.search(r"(\\d{1,2})\\s+([а-яА-Я]+)\\s+(\\d{4})", raw)
    if match:
        day, month_name, year = match.groups()
        month = months.get(month_name.lower())
        if month:
            return f"{year}-{month:02d}-{int(day):02d}"
    return None


def _status_code_from_title(title, index):
    lowered = (title or "").lower()
    mapping = [
        ("создан", "created"),
        ("принят", "accepted"),
        ("в пути", "in_transit"),
        ("прибыл", "arrived"),
        ("готов к выдаче", "ready_for_pickup"),
        ("выдан", "delivered"),
        ("доставлен", "delivered"),
        ("отказ", "cancelled"),
        ("возврат", "returning"),
    ]
    for fragment, code in mapping:
        if fragment in lowered:
            return code
    return f"status_{index + 1}"


def _timeline_item_is_active(item):
    class_attr = (item.get_attribute("class") or "").lower()
    if "active" in class_attr or "current" in class_attr:
        return True
    if (item.get_attribute("data-active") or "").lower() == "true":
        return True
    if (item.get_attribute("data-state") or "").lower() == "active":
        return True
    if (item.get_attribute("aria-current") or "").lower() == "step":
        return True
    for selector in CDEK_TRACKING_SELECTORS["timeline_active"]:
        try:
            if item.locator(selector).count() > 0:
                return True
        except Exception:
            continue
    return False


def _parse_route(route_text):
    if not route_text:
        return "", ""
    cleaned = _normalize_text(route_text)
    if "→" in cleaned:
        parts = [part.strip() for part in cleaned.split("→", 1)]
        if len(parts) == 2:
            return parts[0], parts[1]
    if "-" in cleaned:
        parts = [part.strip() for part in cleaned.split("-", 1)]
        if len(parts) == 2:
            return parts[0], parts[1]
    return "", ""


def _get_cached_tracking(track_number):
    cached = _CDEK_TRACKING_CACHE.get(track_number)
    if not cached:
        return None
    if datetime.utcnow() >= cached["expires_at"]:
        _CDEK_TRACKING_CACHE.pop(track_number, None)
        return None
    return cached["data"]


def _mark_tracking_fetch(track_number):
    global _CDEK_TRACKING_LAST_GLOBAL_FETCH
    now = datetime.utcnow()
    _CDEK_TRACKING_LAST_FETCH[track_number] = now
    _CDEK_TRACKING_LAST_GLOBAL_FETCH = now


def _should_rate_limit(track_number):
    now = datetime.utcnow()
    last_global = _CDEK_TRACKING_LAST_GLOBAL_FETCH
    last_track = _CDEK_TRACKING_LAST_FETCH.get(track_number)
    if last_global and now - last_global < CDEK_TRACKING_MIN_INTERVAL:
        return True
    if last_track and now - last_track < CDEK_TRACKING_MIN_INTERVAL:
        return True
    return False


def _parse_tracking_page(page, track_number):
    body_text = ""
    try:
        body_text = page.inner_text("body") or ""
    except Exception:
        body_text = ""
    lowered_body = body_text.lower()
    if "заказ не найден" in lowered_body or "order not found" in lowered_body:
        raise TrackingError("ORDER_NOT_FOUND")
    if "captcha" in lowered_body or "капча" in lowered_body:
        raise TrackingError("CAPTCHA_REQUIRED")
    if (
        "доступ временно ограничен" in lowered_body
        or "access denied" in lowered_body
        or "temporarily unavailable" in lowered_body
    ):
        raise TrackingError("PAGE_BLOCKED")
    if "слишком много запросов" in lowered_body or "too many requests" in lowered_body:
        raise TrackingError("RATE_LIMIT")

    order_number_text = _extract_first_text(page, CDEK_TRACKING_SELECTORS["order_number"])
    route_text = _extract_first_text(page, CDEK_TRACKING_SELECTORS["route"])
    from_city = _extract_first_text(page, CDEK_TRACKING_SELECTORS["from_city"])
    to_city = _extract_first_text(page, CDEK_TRACKING_SELECTORS["to_city"])
    if route_text and (not from_city or not to_city):
        parsed_from, parsed_to = _parse_route(route_text)
        from_city = from_city or parsed_from
        to_city = to_city or parsed_to

    current_status = _extract_first_text(page, CDEK_TRACKING_SELECTORS["current_status"])
    current_city = _extract_first_text(page, CDEK_TRACKING_SELECTORS["current_city"])

    timeline_items = None
    for selector in CDEK_TRACKING_SELECTORS["timeline_items"]:
        locator = page.locator(selector)
        if locator.count() > 0:
            timeline_items = locator
            break
    if not timeline_items:
        raise TrackingError("PAGE_LAYOUT_CHANGED", "Timeline not found")

    events = []
    active_indices = []
    for idx in range(timeline_items.count()):
        item = timeline_items.nth(idx)
        title = _extract_first_text(item, CDEK_TRACKING_SELECTORS["timeline_title"])
        if not title:
            title = _normalize_text(item.text_content())
        date_text = _extract_first_text(item, CDEK_TRACKING_SELECTORS["timeline_date"])
        parsed_date = _parse_date(date_text or title)
        city_text = _extract_first_text(item, CDEK_TRACKING_SELECTORS["timeline_city"])
        is_active = _timeline_item_is_active(item)
        if is_active:
            active_indices.append(idx)
        events.append(
            {
                "code": _status_code_from_title(title, idx),
                "title": title,
                "date": parsed_date,
                "city": city_text or None,
                "active": is_active,
            }
        )

    if not events:
        raise TrackingError("PAGE_LAYOUT_CHANGED", "Timeline empty")

    active_index = active_indices[-1] if active_indices else len(events) - 1
    active_event = events[active_index]
    if not current_status:
        current_status = active_event.get("title")
    if not current_city:
        current_city = active_event.get("city") or to_city

    response_events = [
        {key: value for key, value in event.items() if key != "active" and value}
        for event in events
    ]
    return {
        "track_number": track_number,
        "order_number": order_number_text or track_number,
        "status": current_status,
        "current_city": current_city,
        "from_city": from_city,
        "to_city": to_city,
        "events": response_events,
    }


def cdek_public_track(track_number):
    cleaned = (track_number or "").strip()
    if not cleaned:
        raise TrackingError("INVALID_TRACK_NUMBER")

    cached = _get_cached_tracking(cleaned)
    if cached:
        return cached

    if _should_rate_limit(cleaned):
        raise TrackingError("RATE_LIMIT")

    _mark_tracking_fetch(cleaned)

    url = CDEK_TRACKING_URL.format(track_number=urllib.parse.quote(cleaned))
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/122.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1280, "height": 720},
            )
            page = context.new_page()
            tracking_payloads = []

            def handle_response(response):
                try:
                    if response.request.resource_type not in {"xhr", "fetch"}:
                        return
                    headers = {key.lower(): value for key, value in response.headers.items()}
                    content_type = headers.get("content-type", "")
                    if "application/json" not in content_type and "json" not in content_type:
                        if "order-history" not in response.url and "trace" not in response.url:
                            return
                    payload = response.json()
                except Exception:
                    return
                if isinstance(payload, (dict, list)):
                    tracking_payloads.append(payload)

            page.on("response", handle_response)
            try:
                page.goto(url, wait_until="networkidle", timeout=20000)
                page.wait_for_timeout(1600)
                data = None
                for payload in tracking_payloads:
                    data = _parse_tracking_payload(payload, cleaned)
                    if data:
                        break
                if not data:
                    data = _parse_tracking_page(page, cleaned)
            finally:
                context.close()
                browser.close()
    except PlaywrightTimeoutError:
        raise TrackingError("TIMEOUT")
    except TrackingError:
        raise
    except Exception as exc:
        raise TrackingError("PAGE_LOAD_FAILED", str(exc))

    _CDEK_TRACKING_CACHE[cleaned] = {
        "data": data,
        "expires_at": datetime.utcnow() + CDEK_TRACKING_CACHE_TTL,
        "cached_at": datetime.utcnow(),
    }
    return data


def resolve_shipment_status(track_number, cdek_uuid):
    try:
        tracking = cdek_public_track(track_number)
    except TrackingError as exc:
        return None, exc.code
    last_date = None
    if tracking.get("events"):
        for event in tracking["events"]:
            if event.get("date"):
                last_date = event["date"]
    return {
        "status": tracking.get("status"),
        "location": tracking.get("current_city"),
        "timestamp": last_date,
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
                   cdek_uuid, cdek_state,
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
    cdek_number = None
    cdek_uuid = (payload.get("cdek_uuid") or display_number).strip() or None
    if not origin_label or not destination_label or not display_number:
        return jsonify({"error": "Заполните все поля поставки"}), 400
    status_data = {
        "status": "⏳ Ожидает регистрации в CDEK",
        "location": None,
        "timestamp": None,
    }
    cdek_state = "PENDING_REGISTRATION"
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
            "SELECT display_number, cdek_uuid FROM shipments WHERE id = ?",
            (shipment_id,),
        ).fetchone()
        if not shipment:
            return jsonify({"error": "Поставка не найдена"}), 404
        track_number = shipment["display_number"]
        if not track_number:
            return jsonify({"error": "Не задан трек-номер поставки"}), 409
        status_data, error = resolve_shipment_status(track_number, shipment["cdek_uuid"])
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


@app.post("/api/track")
def track_public_shipment():
    payload = request.get_json() or {}
    track_number = (payload.get("track_number") or "").strip()
    if not track_number:
        return jsonify({"error": "INVALID_TRACK_NUMBER"}), 400
    try:
        data = cdek_public_track(track_number)
    except TrackingError as exc:
        status_map = {
            "ORDER_NOT_FOUND": 404,
            "RATE_LIMIT": 429,
            "CAPTCHA_REQUIRED": 409,
            "PAGE_BLOCKED": 409,
            "TIMEOUT": 504,
            "INVALID_TRACK_NUMBER": 400,
            "PAGE_LAYOUT_CHANGED": 502,
            "PAGE_LOAD_FAILED": 502,
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
