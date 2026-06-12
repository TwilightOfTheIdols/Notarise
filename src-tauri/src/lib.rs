use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Serialize, Deserialize)]
struct CellFile {
    id: String,
    text: String,
}

const AGENTS_MD: &str = "# Notarise workspace\n\nThis directory is a copy of the user's Notarise document.\n\n- Each cell is a Markdown file at `cells/<id>.md`. The filename (without `.md`) is the stable cell id — never rename it.\n- To change a cell, edit its file's body. TODO lines use `- [ ] item` (open) or `- [x] item` (done); Notarise imports those as real TODO checkboxes.\n- Edits are merged back into the live document when you finish. Keep changes scoped to the files here.\n";

fn workspace_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent-workspace");
    Ok(dir)
}

fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && !id.contains('/')
        && !id.contains('\\')
        && !id.contains("..")
        && id.len() <= 128
}

#[tauri::command]
fn agent_materialize(app: tauri::AppHandle, cells: Vec<CellFile>) -> Result<String, String> {
    let root = workspace_root(&app)?;
    let _ = fs::remove_dir_all(&root);
    let cells_dir = root.join("cells");
    fs::create_dir_all(&cells_dir).map_err(|e| e.to_string())?;

    for cell in &cells {
        if !safe_id(&cell.id) {
            continue;
        }
        let path = cells_dir.join(format!("{}.md", cell.id));
        fs::write(&path, &cell.text).map_err(|e| e.to_string())?;
    }

    fs::write(root.join("AGENTS.md"), AGENTS_MD).map_err(|e| e.to_string())?;
    fs::write(root.join("CLAUDE.md"), AGENTS_MD).map_err(|e| e.to_string())?;

    Ok(root.to_string_lossy().to_string())
}

// macOS/Linux apps launched from Finder/Dock inherit a stripped PATH that often
// omits Homebrew, npm-global, and nvm — so `claude`/`node` won't resolve. Build
// an augmented PATH (common dirs + nvm versions + the inherited PATH) that the
// frontend passes as the spawn env. No-op shape on Windows (callers skip it).
#[tauri::command]
fn agent_path_env() -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        parts.push(format!("{}/.npm-global/bin", home));
        parts.push(format!("{}/.local/bin", home));
        let nvm = PathBuf::from(&home).join(".nvm/versions/node");
        if let Ok(entries) = fs::read_dir(&nvm) {
            for entry in entries.flatten() {
                let bin = entry.path().join("bin");
                if bin.is_dir() {
                    parts.push(bin.to_string_lossy().to_string());
                }
            }
        }
    }
    for dir in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        parts.push(dir.to_string());
    }
    if let Ok(existing) = std::env::var("PATH") {
        parts.push(existing);
    }
    parts.join(":")
}

#[tauri::command]
fn agent_write_prompt(app: tauri::AppHandle, text: String) -> Result<String, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("agent-prompt.txt");
    fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// --- Permission bridge ---------------------------------------------------
// When the agent runs in "ask" mode, Claude calls an MCP "approve" tool for
// each permission. This tiny stdio MCP server (Node) relays each request to a
// file the app polls, and waits for the app to write the user's decision back.

const PERM_SERVER_JS: &str = r#"const fs = require('fs');
const path = require('path');
const dir = process.env.NOTARISE_PERM_DIR || '.';
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) { try { handle(JSON.parse(line)); } catch (e) {} }
  }
});
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function handle(msg) {
  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id: id, result: { protocolVersion: params.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'notarise-perms', version: '1.0.0' } } });
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id: id, result: { tools: [{ name: 'approve', description: 'Request user approval in Notarise for a tool use.', inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' } } } }] } });
  } else if (method === 'tools/call') {
    const args = params.arguments || {};
    const reqId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const reqPath = path.join(dir, 'req-' + reqId + '.json');
    const resPath = path.join(dir, 'res-' + reqId + '.json');
    try { fs.writeFileSync(reqPath, JSON.stringify({ id: reqId, tool_name: args.tool_name || 'tool', input: args.input || {} })); } catch (e) {}
    const timer = setInterval(() => {
      let raw;
      try { raw = fs.readFileSync(resPath, 'utf8'); } catch (e) { return; }
      clearInterval(timer);
      try { fs.unlinkSync(resPath); } catch (e) {}
      try { fs.unlinkSync(reqPath); } catch (e) {}
      let allow = false; let message = 'Denied in Notarise';
      try { const p = JSON.parse(raw); allow = !!p.allow; if (p.message) message = p.message; } catch (e) {}
      const decision = allow ? { behavior: 'allow', updatedInput: args.input || {} } : { behavior: 'deny', message: message };
      send({ jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } });
    }, 200);
  } else if (method && method.indexOf('notifications/') === 0) {
    // notifications get no response
  } else if (id !== undefined && id !== null) {
    send({ jsonrpc: '2.0', id: id, result: {} });
  }
}
"#;

fn perms_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent-perms");
    Ok(dir)
}

#[derive(Serialize)]
struct PermsSetup {
    config_path: String,
}

#[tauri::command]
fn agent_perms_setup(app: tauri::AppHandle) -> Result<PermsSetup, String> {
    let dir = perms_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Clear any stale request/response files from a previous run.
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                if name.starts_with("req-") || name.starts_with("res-") {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }

    let script_path = dir.join("perm-server.cjs");
    fs::write(&script_path, PERM_SERVER_JS).map_err(|e| e.to_string())?;

    let config = serde_json::json!({
        "mcpServers": {
            "perms": {
                "command": "node",
                "args": [script_path.to_string_lossy()],
                "env": { "NOTARISE_PERM_DIR": dir.to_string_lossy() }
            }
        }
    });
    let config_path = dir.join("mcp-config.json");
    fs::write(
        &config_path,
        serde_json::to_string(&config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(PermsSetup {
        config_path: config_path.to_string_lossy().to_string(),
    })
}

#[derive(Serialize)]
struct PermReq {
    id: String,
    tool: String,
    input: serde_json::Value,
}

#[tauri::command]
fn agent_perms_pending(app: tauri::AppHandle) -> Result<Vec<PermReq>, String> {
    let dir = perms_dir(&app)?;
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = match path.file_name().and_then(|s| s.to_str()) {
                Some(n) => n,
                None => continue,
            };
            if !name.starts_with("req-") || !name.ends_with(".json") {
                continue;
            }
            if let Ok(text) = fs::read_to_string(&path) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                    let id = value.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if !safe_id(&id) {
                        continue;
                    }
                    let tool = value
                        .get("tool_name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("tool")
                        .to_string();
                    let input = value.get("input").cloned().unwrap_or(serde_json::Value::Null);
                    out.push(PermReq { id, tool, input });
                }
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn agent_perms_resolve(
    app: tauri::AppHandle,
    id: String,
    allow: bool,
    message: Option<String>,
) -> Result<(), String> {
    if !safe_id(&id) {
        return Err("invalid id".to_string());
    }
    let dir = perms_dir(&app)?;
    let res = serde_json::json!({ "allow": allow, "message": message });
    fs::write(
        dir.join(format!("res-{}.json", id)),
        serde_json::to_string(&res).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn agent_collect(path: String) -> Result<Vec<CellFile>, String> {
    let cells_dir = PathBuf::from(&path).join("cells");
    let mut out = Vec::new();

    let entries = match fs::read_dir(&cells_dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(out),
    };

    for entry in entries.flatten() {
        let file_path = entry.path();
        if file_path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let stem = match file_path.file_stem().and_then(|s| s.to_str()) {
            Some(stem) if safe_id(stem) => stem.to_string(),
            _ => continue,
        };
        if let Ok(text) = fs::read_to_string(&file_path) {
            out.push(CellFile { id: stem, text });
        }
    }

    Ok(out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            agent_materialize,
            agent_path_env,
            agent_write_prompt,
            agent_collect,
            agent_perms_setup,
            agent_perms_pending,
            agent_perms_resolve
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
