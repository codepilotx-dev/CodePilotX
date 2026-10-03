//! CPX-owned stdio host. Native capture/input and MCP dispatch are reused from Cua.
use cua_driver_core::{mcp_wire::ProtocolSession, protocol::{Request, Response}, server::{handle_request_with_transport_session, ToolProvider}, tool::ToolRegistry};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use windows::{core::PWSTR, Win32::{Foundation::{CloseHandle, FILETIME}, System::Threading::{OpenProcess, QueryFullProcessImageNameW, GetProcessTimes, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_NAME_WIN32}}};

const ALLOWED: &[&str] = &["get_window_state", "click", "double_click", "right_click", "type_text", "press_key", "hotkey", "scroll", "drag", "start_session", "end_session"];

#[link(name = "kernel32")]
extern "system" { fn GetApplicationUserModelId(process: windows::Win32::Foundation::HANDLE, length: *mut u32, id: *mut u16) -> i32; }

fn identity(pid: u32) -> Option<(String, String)> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let result = (|| {
            let mut created = FILETIME::default();
            let mut exited = FILETIME::default();
            let mut kernel = FILETIME::default();
            let mut user = FILETIME::default();
            GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user).ok()?;
            let process_key = format!("{}:{}", created.dwHighDateTime, created.dwLowDateTime);
            let mut length = 0;
            GetApplicationUserModelId(handle, &mut length, std::ptr::null_mut());
            if length > 0 {
                let mut id = vec![0u16; length as usize];
                if GetApplicationUserModelId(handle, &mut length, id.as_mut_ptr()) == 0 {
                    let id = String::from_utf16_lossy(&id[..length.saturating_sub(1) as usize]);
                    if !id.is_empty() { return Some((format!("aumid:{id}"), process_key)); }
                }
            }
            let mut path = vec![0u16; 32768];
            let mut size = path.len() as u32;
            QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(path.as_mut_ptr()), &mut size).ok()?;
            let path = String::from_utf16_lossy(&path[..size as usize]);
            let canonical = std::fs::canonicalize(&path).ok()?.to_string_lossy().trim_start_matches(r"\\?\").to_lowercase();
            Some((format!("exe:{canonical}"), process_key))
        })();
        let _ = CloseHandle(handle);
        result
    }
}

struct CpxProvider { registry: ToolRegistry }
#[async_trait::async_trait]
impl ToolProvider for CpxProvider {
    fn tools_list(&self) -> Value {
        let mut list = self.registry.tools_list();
        if let Some(tools) = list["tools"].as_array_mut() {
            tools.retain(|tool| ALLOWED.contains(&tool["name"].as_str().unwrap_or("")));
            for tool in tools.iter_mut() {
                if !matches!(tool["name"].as_str(), Some("start_session" | "end_session")) {
                    tool["inputSchema"]["properties"]["cpx_app_id"] = json!({"type":"string"});
                    tool["inputSchema"]["properties"]["cpx_process_key"] = json!({"type":"string"});
                }
            }
            tools.push(json!({"name":"cpx_apps","description":"Running Windows windows and host-derived identities","inputSchema":{"type":"object","properties":{},"additionalProperties":false}}));
        }
        list
    }
    async fn invoke_tool(&self, name: &str, mut args: Value) -> Result<Value, String> {
        if name == "cpx_apps" {
            let windows = tokio::task::spawn_blocking(|| {
                platform_windows::win32::list_windows(None).into_iter().filter_map(|window| {
                    let (app_id, process_key) = identity(window.pid)?;
                    Some(json!({"appId":app_id,"processKey":process_key,"pid":window.pid,"windowId":window.hwnd.to_string(),"name":window.title}))
                }).collect::<Vec<_>>()
            }).await.map_err(|_| "Application discovery failed")?;
            return Ok(json!({"content":[],"structuredContent":{"windows":windows}}));
        }
        if !ALLOWED.contains(&name) { return Err("Unsupported CPX-CUA tool".into()); }
        if !matches!(name, "start_session" | "end_session") {
            let pid = args["pid"].as_u64().and_then(|pid| u32::try_from(pid).ok()).ok_or("Missing target")?;
            let current = identity(pid).ok_or("Target exited")?;
            if args["cpx_app_id"].as_str() != Some(&current.0) || args["cpx_process_key"].as_str() != Some(&current.1) {
                return Err("Target identity changed; observe again".into());
            }
            let object = args.as_object_mut().ok_or("Invalid arguments")?;
            object.remove("cpx_app_id"); object.remove("cpx_process_key");
        }
        serde_json::to_value(self.registry.invoke_from_trusted_adapter(name, args).await).map_err(|_| "Result encoding failed".into())
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut registry = platform_windows::register_tools();
    registry.register_session_tools();
    let provider = CpxProvider { registry };
    let mut protocol = ProtocolSession::default();
    let mut reader = BufReader::new(tokio::io::stdin());
    let mut writer = tokio::io::BufWriter::new(tokio::io::stdout());
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).await? == 0 { break; }
        if line.trim().is_empty() { continue; }
        let response = match serde_json::from_str::<Request>(&line) {
            Err(_) => Response::parse_error(),
            Ok(request) if request.is_notification() => continue,
            Ok(request) => match protocol.validate(&request) {
                Err(response) => response,
                Ok(_) => { let id = request.id.clone().unwrap_or(Value::Null); handle_request_with_transport_session(request, id, &provider, "cpx-cua").await }
            }
        };
        let mut response = serde_json::to_value(response)?;
        if response["result"]["serverInfo"].is_object() {
            response["result"]["serverInfo"] = json!({"name":"CPX-CUA","version":env!("CARGO_PKG_VERSION")});
            response["result"]["instructions"] = json!("CPX-CUA Windows runtime. Application authorization and control ownership belong to CodePilotX.");
        }
        writer.write_all(serde_json::to_string(&response)?.as_bytes()).await?;
        writer.write_all(b"\n").await?;
        writer.flush().await?;
    }
    Ok(())
}
