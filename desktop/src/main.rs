//! Night Copy for Windows: the game's own backend (progress, sessions, static
//! files) runs inside the app on 127.0.0.1, and a WebView2 window shows it.
//! Progress lives in %APPDATA%\net.wy6y.nightcopy\nightcopy.db.
//!
//! The port is fixed (first free in 51600..51610) because the page's origin
//! includes it, and localStorage (offline cache, unsent sessions) is per origin.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use axum::{
    extract::Request,
    http::{header, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::json;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const PORTS: std::ops::Range<u16> = 51600..51610;

/// The Pi version checks that a shared paddle can't key a radio. A desktop
/// player has no shared radio path through this app, so the paddle is always
/// allowed.
async fn txguard() -> Response {
    let mut resp = Json(json!({
        "verdict": "safe",
        "reason": "Desktop build: no shared radio",
        "age_ms": 0,
    }))
    .into_response();
    resp.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    resp
}

/// Only the app's own window may talk to the server: a web page that rebinds
/// its DNS name to 127.0.0.1 still sends its own Host header.
async fn local_only(req: Request, next: Next) -> Response {
    let ok = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| h.starts_with("127.0.0.1:"));
    if ok { next.run(req).await } else { StatusCode::FORBIDDEN.into_response() }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let web = app.path().resource_dir()?.join("web");
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let db = cybercw_server::open_db(&data.join("nightcopy.db"))?;

            let listener = PORTS
                .clone()
                .find_map(|p| std::net::TcpListener::bind(("127.0.0.1", p)).ok())
                .ok_or("no free port in 51600..51610")?;
            listener.set_nonblocking(true)?;
            let port = listener.local_addr()?.port();

            let router = cybercw_server::router(db, &web)
                .merge(Router::new().route("/api/txguard", get(txguard)))
                .layer(middleware::from_fn(local_only));
            tauri::async_runtime::spawn(async move {
                let listener = tokio::net::TcpListener::from_std(listener).expect("listener");
                axum::serve(listener, router).await.expect("server");
            });

            let url = format!("http://127.0.0.1:{port}/").parse()?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Night Copy")
                .inner_size(1280.0, 760.0)
                .min_inner_size(960.0, 560.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Night Copy failed to start");
}
