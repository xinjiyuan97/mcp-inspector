use std::time::Instant;

use chrono::Utc;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::types::{MessageDirection, MessageLog};

pub fn emit_mcp_message(app: &AppHandle, log: MessageLog) {
    let _ = app.emit("mcp_message", &log);
}

pub fn log_request(app: &AppHandle, method: &str, params: Value) -> Instant {
    emit_mcp_message(
        app,
        MessageLog {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            direction: MessageDirection::Request,
            method: Some(method.to_string()),
            payload: json!({
                "jsonrpc": "2.0",
                "method": method,
                "params": params,
            }),
            duration_ms: None,
        },
    );
    Instant::now()
}

pub fn log_response(app: &AppHandle, method: &str, start: Instant, result: Value) {
    emit_mcp_message(
        app,
        MessageLog {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            direction: MessageDirection::Response,
            method: Some(method.to_string()),
            payload: json!({
                "jsonrpc": "2.0",
                "method": method,
                "result": result,
            }),
            duration_ms: Some(start.elapsed().as_millis() as u64),
        },
    );
}

pub fn log_error(app: &AppHandle, method: &str, start: Instant, error: &str) {
    emit_mcp_message(
        app,
        MessageLog {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            direction: MessageDirection::Error,
            method: Some(method.to_string()),
            payload: json!({
                "jsonrpc": "2.0",
                "method": method,
                "error": { "message": error },
            }),
            duration_ms: Some(start.elapsed().as_millis() as u64),
        },
    );
}
