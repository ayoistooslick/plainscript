// crates/pln-repl/src/bridge.rs
// Subprocess communication bridge connecting the Rust Ratatui TUI to PlainScript compiler IPC.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;

#[derive(Serialize)]
pub struct EvalRequest {
    pub code: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct EvalResponse {
    pub ok: bool,
    pub result: Option<String>,
    pub error: Option<String>,
    pub js: Option<String>,
    pub types: Option<HashMap<String, String>>,
}

pub struct CompilerBridge {
    tx_req: Sender<String>,
    rx_res: Receiver<EvalResponse>,
}

impl CompilerBridge {
    pub fn spawn() -> Result<Self, String> {
        // Locate compiler cli.js relative to executable or working directory
        let candidates = [
            "compiler/cli.js",
            "../compiler/cli.js",
            "../../compiler/cli.js",
        ];
        let cli_path = candidates
            .iter()
            .find(|p| std::path::Path::new(p).exists())
            .cloned()
            .unwrap_or("compiler/cli.js");

        let mut child = Command::new("node")
            .arg(cli_path)
            .arg("repl")
            .arg("--json-ipc")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn PlainScript node compiler ({}): {}", cli_path, e))?;

        let mut stdin = child.stdin.take().ok_or("Failed to open child stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open child stdout")?;

        let (tx_req, rx_req) = channel::<String>();
        let (tx_res, rx_res) = channel::<EvalResponse>();

        // Stdin writer thread
        thread::spawn(move || {
            while let Ok(code) = rx_req.recv() {
                let req = EvalRequest { code };
                if let Ok(json) = serde_json::to_string(&req) {
                    if writeln!(stdin, "{}", json).is_err() {
                        break;
                    }
                    let _ = stdin.flush();
                }
            }
        });

        // Stdout reader thread
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                if let Ok(res) = serde_json::from_str::<EvalResponse>(&line) {
                    let _ = tx_res.send(res);
                }
            }
        });

        Ok(Self { tx_req, rx_res })
    }

    pub fn send_eval(&self, code: &str) -> Result<(), String> {
        self.tx_req
            .send(code.to_string())
            .map_err(|e| format!("Bridge send error: {}", e))
    }

    pub fn try_recv(&self) -> Option<EvalResponse> {
        self.rx_res.try_recv().ok()
    }
}
