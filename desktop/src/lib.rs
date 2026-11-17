//! Night Copy app (Windows, macOS, Linux, Android): the game's own backend
//! (progress, sessions, static files) runs inside the app on 127.0.0.1, and a
//! native web view (WebView2, WKWebView, WebKitGTK or Android's WebView) shows it.
//! Progress lives in the app data folder (%APPDATA%\net.wy6y.nightcopy on
//! Windows, ~/Library/Application Support/net.wy6y.nightcopy on macOS).
//!
//! The port is fixed (first free in 51600..51610) because the page's origin
//! includes it, and localStorage (offline cache, unsent sessions) is per origin.

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

/// The game's files. Desktop ships them as a resource folder next to the app.
#[cfg(not(target_os = "android"))]
fn web_dir(app: &tauri::App) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    Ok(app.path().resource_dir()?.join("web"))
}

/// Android has no resource folder on disk: the game is embedded in the app
/// (frontendDist in tauri.android.conf.json) and unpacked into the cache
/// folder whenever the embedded copy changes, so the server reads it from
/// disk just as on desktop.
#[cfg(target_os = "android")]
fn web_dir(app: &tauri::App) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    use std::hash::{Hash, Hasher};
    let assets = app.asset_resolver();
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    let mut keys = Vec::new();
    for (k, bytes) in assets.iter() {
        k.hash(&mut hash);
        bytes.hash(&mut hash);
        keys.push(k.into_owned());
    }
    let stamp = format!("{:016x}", hash.finish());
    let dir = app.path().app_cache_dir()?.join("web");
    let stamp_file = dir.join(".stamp");
    if std::fs::read_to_string(&stamp_file).is_ok_and(|s| s == stamp) {
        return Ok(dir);
    }
    let _ = std::fs::remove_dir_all(&dir);
    for k in keys {
        let asset = assets.get(k.clone()).ok_or_else(|| format!("embedded file {k} missing"))?;
        let path = dir.join(k.trim_start_matches('/'));
        std::fs::create_dir_all(path.parent().unwrap_or(&dir))?;
        std::fs::write(&path, asset.bytes())?;
    }
    std::fs::write(&stamp_file, stamp)?;
    Ok(dir)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let web = web_dir(app)?;
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
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url));
            #[cfg(desktop)]
            let window = window.title("Night Copy").inner_size(1280.0, 760.0).min_inner_size(960.0, 560.0);
            window.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Night Copy failed to start");
}
