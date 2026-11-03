//! CyberCW backend shared by the Pi service (main.rs) and the Windows desktop
//! app (night-copy). The caller adds `/api/txguard`.
//!
//! - Progress: one JSON document with a revision number. Writes are
//!   compare-and-swap on the revision and read back before answering.
//! - Sessions: one row per finished mission, for the streak and Bud's nudge.
//! - Static files: the PWA in `web`.

use axum::{
    extract::{Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tower_http::{services::ServeDir, set_header::SetResponseHeaderLayer};

struct App {
    db: Mutex<Connection>,
}

type Shared = Arc<App>;

fn err(code: StatusCode, msg: impl Into<String>) -> Response {
    (code, Json(json!({ "error": msg.into() }))).into_response()
}

pub fn open_db(path: &Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=FULL;
         CREATE TABLE IF NOT EXISTS progress (
             id INTEGER PRIMARY KEY CHECK (id = 1),
             rev INTEGER NOT NULL,
             data TEXT NOT NULL,
             updated_ms INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS sessions (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             ts_ms INTEGER NOT NULL,
             day TEXT NOT NULL,
             mission TEXT NOT NULL,
             seconds REAL NOT NULL,
             total INTEGER NOT NULL,
             correct INTEGER NOT NULL,
             detail TEXT NOT NULL);
         CREATE INDEX IF NOT EXISTS sessions_day ON sessions(day);",
    )?;
    Ok(c)
}

fn read_progress(c: &Connection) -> rusqlite::Result<(i64, Value)> {
    let row: Option<(i64, String)> = c
        .query_row("SELECT rev, data FROM progress WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    Ok(match row {
        Some((rev, data)) => (rev, serde_json::from_str(&data).unwrap_or(Value::Null)),
        None => (0, Value::Null),
    })
}

async fn get_progress(State(app): State<Shared>) -> Response {
    let db = app.db.lock().unwrap();
    match read_progress(&db) {
        Ok((rev, data)) => Json(json!({ "rev": rev, "data": data })).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, format!("progress read failed: {e}")),
    }
}

#[derive(Deserialize)]
struct PutProgress {
    base_rev: i64,
    data: Value,
}

async fn put_progress(State(app): State<Shared>, Json(body): Json<PutProgress>) -> Response {
    if !body.data.is_object() {
        return err(StatusCode::BAD_REQUEST, "data must be an object");
    }
    let text = body.data.to_string();
    if text.len() > 512 * 1024 {
        return err(StatusCode::PAYLOAD_TOO_LARGE, "progress over 512 KB");
    }
    let mut db = app.db.lock().unwrap();
    let result = (|| -> rusqlite::Result<Response> {
        let tx = db.transaction()?;
        let (rev, current) = read_progress(&tx)?;
        if rev != body.base_rev {
            return Ok((StatusCode::CONFLICT, Json(json!({ "rev": rev, "data": current }))).into_response());
        }
        tx.execute(
            "INSERT INTO progress (id, rev, data, updated_ms) VALUES (1, ?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET rev = ?1, data = ?2, updated_ms = ?3",
            params![rev + 1, text, now_ms() as i64],
        )?;
        tx.commit()?;
        // Read back and compare before saying it was saved.
        let (new_rev, stored) = read_progress(&db)?;
        if new_rev != rev + 1 || stored != body.data {
            return Ok(err(StatusCode::INTERNAL_SERVER_ERROR, "read-back did not match the write"));
        }
        Ok(Json(json!({ "rev": new_rev, "data": stored })).into_response())
    })();
    result.unwrap_or_else(|e| err(StatusCode::INTERNAL_SERVER_ERROR, format!("progress write failed: {e}")))
}

#[derive(Deserialize)]
struct SessionIn {
    day: String,
    mission: String,
    seconds: f64,
    total: i64,
    correct: i64,
    #[serde(default)]
    detail: Value,
}

fn valid_day(d: &str) -> bool {
    d.len() == 10 && d.as_bytes()[4] == b'-' && d.as_bytes()[7] == b'-'
        && d.bytes().enumerate().all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
}

async fn post_session(State(app): State<Shared>, Json(s): Json<SessionIn>) -> Response {
    if !valid_day(&s.day) || s.mission.len() > 32 {
        return err(StatusCode::BAD_REQUEST, "bad day or mission");
    }
    let db = app.db.lock().unwrap();
    let r = db.execute(
        "INSERT INTO sessions (ts_ms, day, mission, seconds, total, correct, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![now_ms() as i64, s.day, s.mission, s.seconds, s.total, s.correct, s.detail.to_string()],
    );
    match r {
        Ok(_) => Json(json!({ "ok": true, "id": db.last_insert_rowid() })).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, format!("session write failed: {e}")),
    }
}

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default)]
    limit: Option<i64>,
}

/// Recent missions, oldest first, for the COACH screen's trends.
async fn list_sessions(State(app): State<Shared>, Query(q): Query<ListQuery>) -> Response {
    let limit = q.limit.unwrap_or(300).clamp(1, 2000);
    let db = app.db.lock().unwrap();
    let run = || -> rusqlite::Result<Vec<Value>> {
        let mut st = db.prepare(
            "SELECT * FROM (SELECT id, ts_ms, day, mission, seconds, total, correct, detail FROM sessions ORDER BY id DESC LIMIT ?1) ORDER BY id",
        )?;
        let rows = st.query_map([limit], |r| {
            let detail: String = r.get(7)?;
            Ok(json!({
                "id": r.get::<_, i64>(0)?, "ts_ms": r.get::<_, i64>(1)?, "day": r.get::<_, String>(2)?,
                "mission": r.get::<_, String>(3)?, "seconds": r.get::<_, f64>(4)?,
                "total": r.get::<_, i64>(5)?, "correct": r.get::<_, i64>(6)?,
                "detail": serde_json::from_str::<Value>(&detail).unwrap_or(Value::Null),
            }))
        })?;
        rows.collect()
    };
    match run() {
        Ok(v) => Json(json!({ "sessions": v })).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, format!("session list failed: {e}")),
    }
}

#[derive(Deserialize)]
struct DayQuery {
    day: String,
}

/// Days are local (Central) dates supplied by the caller, so the Pi needs no
/// time-zone table. Streak counts back from `day` (or the day before, if
/// today has no session yet).
fn prev_day(d: &str) -> Option<String> {
    let y: i32 = d[0..4].parse().ok()?;
    let m: u32 = d[5..7].parse().ok()?;
    let day: u32 = d[8..10].parse().ok()?;
    if day > 1 {
        return Some(format!("{y:04}-{m:02}-{:02}", day - 1));
    }
    let (py, pm) = if m == 1 { (y - 1, 12) } else { (y, m - 1) };
    let leap = (py % 4 == 0 && py % 100 != 0) || py % 400 == 0;
    let dim = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][(pm - 1) as usize];
    Some(format!("{py:04}-{pm:02}-{dim:02}"))
}

async fn summary(State(app): State<Shared>, Query(q): Query<DayQuery>) -> Response {
    if !valid_day(&q.day) {
        return err(StatusCode::BAD_REQUEST, "day must be YYYY-MM-DD (America/Chicago)");
    }
    let db = app.db.lock().unwrap();
    let run = || -> rusqlite::Result<Value> {
        let mut st = db.prepare("SELECT DISTINCT day FROM sessions WHERE day <= ?1 ORDER BY day DESC LIMIT 400")?;
        let days: Vec<String> = st.query_map([&q.day], |r| r.get(0))?.collect::<Result<_, _>>()?;
        let today = days.first().map(|d| d == &q.day).unwrap_or(false);
        let mut streak = 0;
        let mut want = if today { Some(q.day.clone()) } else { prev_day(&q.day) };
        for d in &days {
            match &want {
                Some(w) if w == d => {
                    streak += 1;
                    want = prev_day(d);
                }
                Some(w) if d > w => continue,
                _ => break,
            }
        }
        let (secs, missions): (f64, i64) = db.query_row(
            "SELECT COALESCE(SUM(seconds), 0), COUNT(*) FROM sessions WHERE day = ?1",
            [&q.day],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let (_, prog) = read_progress(&db)?;
        Ok(json!({
            "day": q.day,
            "practiced_today": today,
            "missions_today": missions,
            "minutes_today": (secs / 60.0 * 10.0).round() / 10.0,
            "streak": streak,
            "last_day": days.first(),
            "unlocked": prog.get("unlocked"),
            "weak": prog.get("weak"),
        }))
    };
    match run() {
        Ok(v) => Json(v).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, format!("summary failed: {e}")),
    }
}

async fn health(State(app): State<Shared>) -> Response {
    let ok = app.db.lock().unwrap().query_row("SELECT 1", [], |r| r.get::<_, i64>(0)).is_ok();
    Json(json!({ "ok": ok, "service": "cybercw", "time_ms": now_ms() })).into_response()
}

/// Every route but `/api/txguard`, with `web` as the static root.
pub fn router(db: Connection, web: &Path) -> Router {
    let app = Arc::new(App { db: Mutex::new(db) });
    let no_cache = SetResponseHeaderLayer::if_not_present(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    Router::new()
        .route("/api/health", get(health))
        .route("/api/progress", get(get_progress).put(put_progress))
        .route("/api/session", get(list_sessions).post(post_session))
        .route("/api/summary", get(summary))
        .fallback_service(ServeDir::new(web).append_index_html_on_directories(true))
        .layer(no_cache)
        .with_state(app)
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}
