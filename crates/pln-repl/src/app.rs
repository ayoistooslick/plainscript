// crates/pln-repl/src/app.rs
// Application state for the PlainScript Agentic REPL.

use crate::bridge::CompilerBridge;
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub enum HistoryKind {
    UserPrompt,
    AgentOutput,
    AgentError,
    AgentThought,
}

#[derive(Clone, Debug)]
pub struct HistoryItem {
    pub kind: HistoryKind,
    pub content: String,
}

#[derive(PartialEq, Eq, Clone, Copy)]
pub enum Tab {
    Types,
    Js,
    Cheatsheet,
}

pub struct App {
    pub history: Vec<HistoryItem>,
    pub input: String,
    pub cursor_pos: usize,
    pub scroll: usize,
    pub active_tab: Tab,
    pub agent_status: String,
    pub inferred_types: HashMap<String, String>,
    pub latest_js: String,
    pub bridge: Option<CompilerBridge>,
    pub should_quit: bool,
}

impl App {
    pub fn new() -> Self {
        let bridge = CompilerBridge::spawn().ok();

        let welcome_items = vec![
            HistoryItem {
                kind: HistoryKind::AgentThought,
                content: "PlainScript Agentic REPL initialized. Powered by Rust & Ratatui.".into(),
            },
            HistoryItem {
                kind: HistoryKind::AgentThought,
                content: "Type code directly (e.g. `remember x as 10`, `x becomes x + 5`) or `:help` for commands.".into(),
            },
        ];

        Self {
            history: welcome_items,
            input: String::new(),
            cursor_pos: 0,
            scroll: 0,
            active_tab: Tab::Types,
            agent_status: "READY".into(),
            inferred_types: HashMap::new(),
            latest_js: String::new(),
            bridge,
            should_quit: false,
        }
    }

    pub fn handle_char(&mut self, c: char) {
        self.input.insert(self.cursor_pos, c);
        self.cursor_pos += 1;
    }

    pub fn handle_backspace(&mut self) {
        if self.cursor_pos > 0 && !self.input.is_empty() {
            self.cursor_pos -= 1;
            self.input.remove(self.cursor_pos);
        }
    }

    pub fn handle_delete(&mut self) {
        if self.cursor_pos < self.input.len() {
            self.input.remove(self.cursor_pos);
        }
    }

    pub fn move_cursor_left(&mut self) {
        if self.cursor_pos > 0 {
            self.cursor_pos -= 1;
        }
    }

    pub fn move_cursor_right(&mut self) {
        if self.cursor_pos < self.input.len() {
            self.cursor_pos += 1;
        }
    }

    pub fn next_tab(&mut self) {
        self.active_tab = match self.active_tab {
            Tab::Types => Tab::Js,
            Tab::Js => Tab::Cheatsheet,
            Tab::Cheatsheet => Tab::Types,
        };
    }

    pub fn submit(&mut self) {
        let trimmed = self.input.trim().to_string();
        if trimmed.is_empty() {
            return;
        }

        // Handle meta commands
        if trimmed == ":quit" || trimmed == ":exit" || trimmed == ".exit" {
            self.should_quit = true;
            return;
        }
        if trimmed == ":clear" || trimmed == ".clear" {
            self.history.clear();
            self.input.clear();
            self.cursor_pos = 0;
            return;
        }
        if trimmed == ":help" || trimmed == ".help" {
            self.history.push(HistoryItem {
                kind: HistoryKind::UserPrompt,
                content: trimmed,
            });
            self.history.push(HistoryItem {
                kind: HistoryKind::AgentThought,
                content: "Commands:\n  :help       Show available commands\n  :clear      Clear conversation history\n  :types      Switch inspector to Inferred Types\n  :js         Switch inspector to Generated JS\n  :exit       Quit the REPL".into(),
            });
            self.input.clear();
            self.cursor_pos = 0;
            return;
        }
        if trimmed == ":types" {
            self.active_tab = Tab::Types;
            self.input.clear();
            self.cursor_pos = 0;
            return;
        }
        if trimmed == ":js" {
            self.active_tab = Tab::Js;
            self.input.clear();
            self.cursor_pos = 0;
            return;
        }

        // Record User Entry
        self.history.push(HistoryItem {
            kind: HistoryKind::UserPrompt,
            content: trimmed.clone(),
        });

        self.agent_status = "EVALUATING".into();

        if let Some(ref bridge) = self.bridge {
            let _ = bridge.send_eval(&trimmed);
        } else {
            self.history.push(HistoryItem {
                kind: HistoryKind::AgentError,
                content: "Compiler bridge unavailable. Ensure Node.js is installed.".into(),
            });
            self.agent_status = "READY".into();
        }

        self.input.clear();
        self.cursor_pos = 0;
    }

    pub fn poll_bridge(&mut self) {
        if let Some(ref bridge) = self.bridge {
            while let Some(res) = bridge.try_recv() {
                if res.ok {
                    if let Some(types) = res.types {
                        self.inferred_types.extend(types);
                    }
                    if let Some(js) = res.js {
                        self.latest_js = js;
                    }
                    if let Some(result) = res.result {
                        if !result.is_empty() {
                            self.history.push(HistoryItem {
                                kind: HistoryKind::AgentOutput,
                                content: result,
                            });
                        }
                    }
                    self.agent_status = "READY".into();
                } else if let Some(err) = res.error {
                    self.history.push(HistoryItem {
                        kind: HistoryKind::AgentError,
                        content: err,
                    });
                    self.agent_status = "ERROR".into();
                }
            }
        }
    }
}
