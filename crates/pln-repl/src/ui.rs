// crates/pln-repl/src/ui.rs
// PostHog CLI / Claude Code / Hermes Agent UI layout and view rendering.

use crate::app::{App, HistoryKind, Tab};
use crate::logo::LogoWidget;
use crate::theme::Theme;
use ratatui::{
    buffer::Buffer,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Paragraph, StatefulWidget, Tabs, Widget, Wrap},
    Frame,
};

pub fn draw(f: &mut Frame, app: &mut App) {
    let theme = Theme::default();
    let size = f.area();

    // Vertical layout: Header (3) -> Main split (Min) -> Input Area (3) -> Footer (1)
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(8),
            Constraint::Length(3),
            Constraint::Length(1),
        ])
        .split(size);

    draw_header(f, app, &theme, chunks[0]);
    draw_main(f, app, &theme, chunks[1]);
    draw_input(f, app, &theme, chunks[2]);
    draw_footer(f, app, &theme, chunks[3]);
}

fn draw_header(f: &mut Frame, app: &App, theme: &Theme, area: Rect) {
    let header_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Length(12), // Brand badge
            Constraint::Min(20),   // Title & version
            Constraint::Length(18), // Agent status pill
        ])
        .split(area);

    // 1. Canonical PLN Brand Badge
    let brand = Paragraph::new(Line::from(vec![
        Span::styled("  PLN  ", theme.badge_style()),
    ]))
    .block(Block::default().borders(Borders::NONE));
    f.render_widget(brand, header_chunks[0]);

    // 2. Title and subtitle
    let title = Paragraph::new(vec![
        Line::from(vec![
            Span::styled("PlainScript ", Style::default().fg(theme.text_main).add_modifier(Modifier::BOLD)),
            Span::styled("Agentic REPL ", Style::default().fg(theme.pln_emerald)),
            Span::styled("v1.0.4", Style::default().fg(theme.text_dim)),
        ]),
        Line::from(Span::styled("Intent-Oriented Compiler & Semantic Environment", Style::default().fg(theme.text_muted))),
    ]);
    f.render_widget(title, header_chunks[1]);

    // 3. Agent status pill
    let pill_text = format!(" [● {}] ", app.agent_status);
    let pill = Paragraph::new(Line::from(Span::styled(
        pill_text,
        theme.agent_pill_style(&app.agent_status),
    )))
    .alignment(Alignment::Right);
    f.render_widget(pill, header_chunks[2]);
}

fn draw_main(f: &mut Frame, app: &App, theme: &Theme, area: Rect) {
    // 65% Conversation Stream / 35% Live Inspector
    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(65), Constraint::Percentage(35)])
        .split(area);

    draw_conversation(f, app, theme, main_chunks[0]);
    draw_inspector(f, app, theme, main_chunks[1]);
}

fn draw_conversation(f: &mut Frame, app: &App, theme: &Theme, area: Rect) {
    let mut lines = Vec::new();

    for item in &app.history {
        match item.kind {
            HistoryKind::UserPrompt => {
                lines.push(Line::from(vec![
                    Span::styled("❯ ", Style::default().fg(theme.pln_green).add_modifier(Modifier::BOLD)),
                    Span::styled(&item.content, Style::default().fg(theme.text_main).add_modifier(Modifier::BOLD)),
                ]));
            }
            HistoryKind::AgentOutput => {
                for line in item.content.lines() {
                    lines.push(Line::from(vec![
                        Span::styled("  = ", Style::default().fg(theme.accent_cyan)),
                        Span::styled(line, Style::default().fg(theme.text_main)),
                    ]));
                }
                lines.push(Line::from("")); // spacer
            }
            HistoryKind::AgentError => {
                for line in item.content.lines() {
                    lines.push(Line::from(vec![
                        Span::styled("  ✗ ", Style::default().fg(theme.accent_rose).add_modifier(Modifier::BOLD)),
                        Span::styled(line, Style::default().fg(theme.accent_rose)),
                    ]));
                }
                lines.push(Line::from("")); // spacer
            }
            HistoryKind::AgentThought => {
                for line in item.content.lines() {
                    lines.push(Line::from(vec![
                        Span::styled("  ℹ ", Style::default().fg(theme.text_muted)),
                        Span::styled(line, Style::default().fg(theme.text_muted)),
                    ]));
                }
                lines.push(Line::from("")); // spacer
            }
        }
    }

    let block = Block::default()
        .title(Span::styled(" Session Stream ", Style::default().fg(theme.text_main).add_modifier(Modifier::BOLD)))
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(theme.border_style());

    let p = Paragraph::new(lines)
        .block(block)
        .wrap(Wrap { trim: false });

    f.render_widget(p, area);
}

fn draw_inspector(f: &mut Frame, app: &App, theme: &Theme, area: Rect) {
    let titles = vec!["[1: Types]", "[2: JS Output]", "[3: Cheatsheet]"];
    let selected_idx = match app.active_tab {
        Tab::Types => 0,
        Tab::Js => 1,
        Tab::Cheatsheet => 2,
    };

    let inspector_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(5)])
        .split(area);

    let tabs = Tabs::new(titles)
        .block(
            Block::default()
                .title(" Inspector ")
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(theme.border_style()),
        )
        .select(selected_idx)
        .style(Style::default().fg(theme.text_muted))
        .highlight_style(
            Style::default()
                .fg(theme.pln_emerald)
                .add_modifier(Modifier::BOLD),
        );
    f.render_widget(tabs, inspector_chunks[0]);

    let content_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(theme.border_style());

    match app.active_tab {
        Tab::Types => {
            let mut lines = Vec::new();
            if app.inferred_types.is_empty() {
                lines.push(Line::from(Span::styled(
                    "No variables in scope yet.\nDeclare variables using `remember x as 10`.",
                    Style::default().fg(theme.text_muted),
                )));
            } else {
                for (var, typ) in &app.inferred_types {
                    lines.push(Line::from(vec![
                        Span::styled(format!("  {} ", var), Style::default().fg(theme.accent_cyan).add_modifier(Modifier::BOLD)),
                        Span::styled(": ", Style::default().fg(theme.text_muted)),
                        Span::styled(typ, Style::default().fg(theme.pln_green)),
                    ]));
                }
            }
            let p = Paragraph::new(lines).block(content_block);
            f.render_widget(p, inspector_chunks[1]);
        }
        Tab::Js => {
            let p = Paragraph::new(if app.latest_js.is_empty() {
                "// Emitted JavaScript will appear here.".into()
            } else {
                app.latest_js.as_str()
            })
            .block(content_block)
            .style(Style::default().fg(theme.text_muted));
            f.render_widget(p, inspector_chunks[1]);
        }
        Tab::Cheatsheet => {
            let cheatsheet_text = vec![
                Line::from(Span::styled("Natural Language Syntax:", Style::default().fg(theme.pln_emerald).add_modifier(Modifier::BOLD))),
                Line::from("  repeat 5 times ... done"),
                Line::from("  repeat with x in list ... done"),
                Line::from("  first / last item of list"),
                Line::from("  count of list"),
                Line::from(""),
                Line::from(Span::styled("Comparisons:", Style::default().fg(theme.accent_cyan).add_modifier(Modifier::BOLD))),
                Line::from("  is equal to / is not equal to"),
                Line::from("  is in / is not in"),
                Line::from("  is more than / at least / at most"),
            ];
            let p = Paragraph::new(cheatsheet_text).block(content_block);
            f.render_widget(p, inspector_chunks[1]);
        }
    }
}

fn draw_input(f: &mut Frame, app: &App, theme: &Theme, area: Rect) {
    let block = Block::default()
        .title(" Prompt ")
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme.pln_green));

    let display_text = format!("pln > {}", app.input);
    let p = Paragraph::new(display_text)
        .block(block)
        .style(Style::default().fg(theme.text_main));

    f.render_widget(p, area);
}

fn draw_footer(f: &mut Frame, _app: &App, theme: &Theme, area: Rect) {
    let shortcuts = Line::from(vec![
        Span::styled(" [Enter] ", Style::default().fg(theme.pln_green).add_modifier(Modifier::BOLD)),
        Span::styled("Send   ", Style::default().fg(theme.text_dim)),
        Span::styled(" [Tab] ", Style::default().fg(theme.pln_green).add_modifier(Modifier::BOLD)),
        Span::styled("Switch Tab   ", Style::default().fg(theme.text_dim)),
        Span::styled(" [:help] ", Style::default().fg(theme.pln_green).add_modifier(Modifier::BOLD)),
        Span::styled("Help   ", Style::default().fg(theme.text_dim)),
        Span::styled(" [:clear] ", Style::default().fg(theme.pln_green).add_modifier(Modifier::BOLD)),
        Span::styled("Clear   ", Style::default().fg(theme.text_dim)),
        Span::styled(" [:exit] ", Style::default().fg(theme.pln_green).add_modifier(Modifier::BOLD)),
        Span::styled("Quit", Style::default().fg(theme.text_dim)),
    ]);
    let footer = Paragraph::new(shortcuts).alignment(Alignment::Center);
    f.render_widget(footer, area);
}
