// KeysArk 桌面外壳:启动时拉起 Node sidecar(Next.js standalone + launcher),
// 等本地接口就绪后,把窗口指向 http://127.0.0.1:{port}。
// sidecar 负责密文中转 + OAuth + 本地 token;Rust 侧只管进程生命周期与窗口导航。
use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const DEFAULT_PORT: u16 = 35291;

/// 持有 sidecar 子进程句柄,退出时回收。
struct Sidecar(Mutex<Option<Child>>);

fn keysark_dir() -> Option<PathBuf> {
    dirs_home().map(|h| h.join(".keysark"))
}

/// 极简 home 解析(避免引第三方 crate)。
fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// 端口优先级:~/.keysark/desktop.json.port > 默认 35291。
fn resolve_port() -> u16 {
    let Some(cfg) = keysark_dir().map(|d| d.join("desktop.json")) else {
        return DEFAULT_PORT;
    };
    let Ok(txt) = std::fs::read_to_string(cfg) else {
        return DEFAULT_PORT;
    };
    serde_json::from_str::<serde_json::Value>(&txt)
        .ok()
        .and_then(|v| v.get("port").and_then(|p| p.as_u64()))
        .map(|p| p as u16)
        .unwrap_or(DEFAULT_PORT)
}

/// sidecar 入口:打包后位于资源目录的 sidecar/launch.mjs;由 node 运行。
fn sidecar_entry(app: &tauri::App) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|r| r.join("sidecar").join("launch.mjs"))
}

fn spawn_sidecar(app: &tauri::App, port: u16) -> Option<Child> {
    let entry = sidecar_entry(app)?;
    let mut child = Command::new("node")
        .arg(entry)
        .env("KEYSARK_LOCAL_PORT", port.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .ok()?;
    // 把 sidecar stdout 透到日志(也是「就绪」信号来源)。
    if let Some(out) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                println!("[sidecar] {line}");
            }
        });
    }
    Some(child)
}

/// 轮询 TCP 直到本地接口可连(最多等 ~20s)。
fn wait_until_ready(port: u16) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // dev:KEYSARK_DESKTOP_URL 指向运行中的 web server(如 :6134),不起 sidecar。
            // 生产:起 Node sidecar(standalone Next.js),等就绪后指向 127.0.0.1:{port}。
            let url = match std::env::var("KEYSARK_DESKTOP_URL") {
                Ok(u) if !u.is_empty() => u,
                _ => {
                    let port = resolve_port();
                    let child = spawn_sidecar(app, port);
                    app.manage(Sidecar(Mutex::new(child)));
                    wait_until_ready(port);
                    format!("http://127.0.0.1:{port}")
                }
            };
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(url.parse().expect("valid url")),
            )
            .title("KeysArk")
            .inner_size(1100.0, 760.0)
            .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关窗即回收 sidecar。
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<Sidecar>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
