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

// Unique per turn so concurrent sessions can't clobber each other's prompt
// before the shell reads it; stale ones are swept on the next call.
#[tauri::command]
fn agent_write_prompt(app: tauri::AppHandle, text: String) -> Result<String, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_prompt = path
                .file_name()
                .and_then(|s| s.to_str())
                .map(|name| name.starts_with("agent-prompt"))
                .unwrap_or(false);
            let is_stale = entry
                .metadata()
                .and_then(|meta| meta.modified())
                .ok()
                .and_then(|modified| modified.elapsed().ok())
                .map(|age| age.as_secs() > 3600)
                .unwrap_or(false);
            if is_prompt && is_stale {
                let _ = fs::remove_file(&path);
            }
        }
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = dir.join(format!("agent-prompt-{}.txt", nanos));
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
process.stdin.on('end', () => process.exit(0));
process.stdin.on('close', () => process.exit(0));
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
    const started = Date.now();
    const timer = setInterval(() => {
      let raw;
      try { raw = fs.readFileSync(resPath, 'utf8'); } catch (e) {
        if (Date.now() - started > 900000) {
          clearInterval(timer);
          try { fs.unlinkSync(reqPath); } catch (e2) {}
          send({ jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: JSON.stringify({ behavior: 'deny', message: 'Timed out waiting for approval in Notarise' }) }] } });
        }
        return;
      }
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

// MCP server exposing Notarise document actions (create cells/layers, search,
// navigate). Each tool call is relayed to the app via act-req/act-res files,
// and the app returns a JSON result the agent can read.
const NOTARISE_SERVER_JS: &str = r#"const fs = require('fs');
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
process.stdin.on('end', () => process.exit(0));
process.stdin.on('close', () => process.exit(0));
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
const TOOLS = [
  { name: 'search', description: 'Search the Notarise document for cells whose text matches a query. Returns matching cell ids, layer, and a snippet.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'list_layers', description: 'List all layers with their title and cell count.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_cells', description: 'List cells, optionally filtered to one layer. Returns id, layer, and a title snippet.', inputSchema: { type: 'object', properties: { layer: { type: 'number' } } } },
  { name: 'get_cell', description: 'Get the full text and position of one cell by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'create_cell', description: 'Create a new cell with the given text. Optionally specify a layer (defaults to the current one) and x/y position.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, layer: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['text'] } },
  { name: 'update_cell', description: 'Replace the full text of an existing cell by id. TODO lines use "- [ ] item" (open) or "- [x] item" (done).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } },
  { name: 'create_layer', description: 'Create a new layer. Optionally give it a title and position ("above" the top, default, or "below" the bottom).', inputSchema: { type: 'object', properties: { title: { type: 'string' }, position: { type: 'string', enum: ['above', 'below'] } } } },
  { name: 'goto_layer', description: 'Navigate the Notarise canvas to a layer.', inputSchema: { type: 'object', properties: { layer: { type: 'number' } }, required: ['layer'] } }
];
function handle(msg) {
  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id: id, result: { protocolVersion: params.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'notarise', version: '1.0.0' } } });
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id: id, result: { tools: TOOLS } });
  } else if (method === 'tools/call') {
    const name = params.name;
    const args = params.arguments || {};
    const reqId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const reqPath = path.join(dir, 'act-req-' + reqId + '.json');
    const resPath = path.join(dir, 'act-res-' + reqId + '.json');
    try { fs.writeFileSync(reqPath, JSON.stringify({ id: reqId, tool: name, args: args })); } catch (e) {}
    const started = Date.now();
    const timer = setInterval(() => {
      let raw;
      try { raw = fs.readFileSync(resPath, 'utf8'); } catch (e) {
        if (Date.now() - started > 60000) {
          clearInterval(timer);
          try { fs.unlinkSync(reqPath); } catch (e2) {}
          send({ jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: 'Error: Notarise did not respond' }], isError: true } });
        }
        return;
      }
      clearInterval(timer);
      try { fs.unlinkSync(resPath); } catch (e) {}
      try { fs.unlinkSync(reqPath); } catch (e) {}
      let ok = false; let result = null; let error = 'No response';
      try { const p = JSON.parse(raw); ok = !!p.ok; result = p.result; if (p.error) error = p.error; } catch (e) {}
      if (ok) {
        send({ jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
      } else {
        send({ jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: 'Error: ' + error }], isError: true } });
      }
    }, 150);
  } else if (method && method.indexOf('notifications/') === 0) {
    // notifications get no response
  } else if (id !== undefined && id !== null) {
    send({ jsonrpc: '2.0', id: id, result: {} });
  }
}
"#;

// Resolve an absolute path to `node` so claude can spawn the MCP servers even
// when the app's inherited PATH is missing the Node dir (common for GUI-launched
// apps). Falls back to the bare name if not found.
fn find_node() -> String {
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(path) = std::env::var("PATH") {
        let sep = if cfg!(windows) { ';' } else { ':' };
        for dir in path.split(sep) {
            if !dir.is_empty() {
                candidates.push(PathBuf::from(dir).join(exe));
            }
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let nvm = PathBuf::from(&home).join(".nvm/versions/node");
        if let Ok(entries) = fs::read_dir(&nvm) {
            for entry in entries.flatten() {
                candidates.push(entry.path().join("bin").join(exe));
            }
        }
    }
    for dir in [
        "C:/Program Files/nodejs",
        "C:/Program Files (x86)/nodejs",
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
    ] {
        candidates.push(PathBuf::from(dir).join(exe));
    }
    for candidate in candidates {
        if candidate.is_file() {
            return candidate.to_string_lossy().to_string();
        }
    }
    exe.to_string()
}

fn perms_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent-perms");
    Ok(dir)
}

// Write via temp file + rename so the bridge server (which polls with a bare
// read) can never observe a half-written response. The temp name lacks the
// `.json` suffix, so the pending-file scanners skip it too.
fn write_atomic(path: &PathBuf, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct McpSetup {
    config_path: String,
}

// Writes the MCP server scripts and an mcp-config. The `notarise` actions server
// is always included; the `perms` approval server only when `ask` (ask-each-edit
// mode). Clears stale request/response files from a previous run.
#[tauri::command]
fn agent_mcp_setup(app: tauri::AppHandle, ask: bool) -> Result<McpSetup, String> {
    let dir = perms_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                if name.starts_with("req-")
                    || name.starts_with("res-")
                    || name.starts_with("act-req-")
                    || name.starts_with("act-res-")
                {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }

    let perm_script = dir.join("perm-server.cjs");
    fs::write(&perm_script, PERM_SERVER_JS).map_err(|e| e.to_string())?;
    let notarise_script = dir.join("notarise-server.cjs");
    fs::write(&notarise_script, NOTARISE_SERVER_JS).map_err(|e| e.to_string())?;

    let node = find_node();
    let mut servers = serde_json::Map::new();
    servers.insert(
        "notarise".to_string(),
        serde_json::json!({
            "command": node,
            "args": [notarise_script.to_string_lossy()],
            "env": { "NOTARISE_PERM_DIR": dir.to_string_lossy() }
        }),
    );
    if ask {
        servers.insert(
            "perms".to_string(),
            serde_json::json!({
                "command": node,
                "args": [perm_script.to_string_lossy()],
                "env": { "NOTARISE_PERM_DIR": dir.to_string_lossy() }
            }),
        );
    }

    let config = serde_json::json!({ "mcpServers": serde_json::Value::Object(servers) });
    let config_path = dir.join("mcp-config.json");
    fs::write(
        &config_path,
        serde_json::to_string(&config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(McpSetup {
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
    write_atomic(
        &dir.join(format!("res-{}.json", id)),
        &serde_json::to_string(&res).map_err(|e| e.to_string())?,
    )
}

// --- Notarise action bridge ---------------------------------------------
#[derive(Serialize)]
struct ActionReq {
    id: String,
    tool: String,
    args: serde_json::Value,
}

#[tauri::command]
fn agent_actions_pending(app: tauri::AppHandle) -> Result<Vec<ActionReq>, String> {
    let dir = perms_dir(&app)?;
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = match path.file_name().and_then(|s| s.to_str()) {
                Some(n) => n,
                None => continue,
            };
            if !name.starts_with("act-req-") || !name.ends_with(".json") {
                continue;
            }
            if let Ok(text) = fs::read_to_string(&path) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                    let id = value.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if !safe_id(&id) {
                        continue;
                    }
                    let tool = value
                        .get("tool")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let args = value.get("args").cloned().unwrap_or(serde_json::Value::Null);
                    out.push(ActionReq { id, tool, args });
                }
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn agent_actions_resolve(
    app: tauri::AppHandle,
    id: String,
    ok: bool,
    result: Option<serde_json::Value>,
    error: Option<String>,
) -> Result<(), String> {
    if !safe_id(&id) {
        return Err("invalid id".to_string());
    }
    let dir = perms_dir(&app)?;
    let res = serde_json::json!({ "ok": ok, "result": result, "error": error });
    write_atomic(
        &dir.join(format!("act-res-{}.json", id)),
        &serde_json::to_string(&res).map_err(|e| e.to_string())?,
    )
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
            agent_mcp_setup,
            agent_perms_pending,
            agent_perms_resolve,
            agent_actions_pending,
            agent_actions_resolve
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
