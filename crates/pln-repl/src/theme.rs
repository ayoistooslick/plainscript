// crates/pln-repl/src/theme.rs
// PostHog CLI / Claude Code / Hermes Agent UI Theme Tokens for PlainScript.

use ratatui::style::{Color, Modifier, Style};

pub struct Theme {
    pub pln_green: Color,
    pub pln_emerald: Color,
    pub bg_dark: Color,
    pub card_bg: Color,
    pub card_border: Color,
    pub text_main: Color,
    pub text_muted: Color,
    pub text_dim: Color,
    pub accent_cyan: Color,
    pub accent_amber: Color,
    pub accent_rose: Color,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            pln_green: Color::Rgb(46, 164, 79),    // Canonical PlainScript Green (#2ea44f)
            pln_emerald: Color::Rgb(52, 199, 89),  // Light vibrant green highlight
            bg_dark: Color::Rgb(14, 17, 23),       // Deep slate charcoal
            card_bg: Color::Rgb(22, 27, 34),       // Card container background
            card_border: Color::Rgb(48, 54, 61),   // Subtle editorial divider
            text_main: Color::Rgb(240, 246, 252),  // High-contrast crisp white
            text_muted: Color::Rgb(139, 148, 158), // Slate gray secondary text
            text_dim: Color::Rgb(80, 88, 100),     // Breadcrumb / footnote gray
            accent_cyan: Color::Rgb(88, 166, 255), // Secondary agent pill
            accent_amber: Color::Rgb(210, 153, 34),// Warning / thinking state
            accent_rose: Color::Rgb(248, 81, 73),  // Error / syntax violation
        }
    }
}

impl Theme {
    pub fn badge_style(&self) -> Style {
        Style::default()
            .fg(self.text_main)
            .bg(self.pln_green)
            .add_modifier(Modifier::BOLD)
    }

    pub fn agent_pill_style(&self, status: &str) -> Style {
        match status {
            "EVALUATING" | "THINKING" => Style::default()
                .fg(Color::Black)
                .bg(self.accent_amber)
                .add_modifier(Modifier::BOLD),
            "READY" | "IDLE" => Style::default()
                .fg(Color::Black)
                .bg(self.pln_green)
                .add_modifier(Modifier::BOLD),
            "ERROR" => Style::default()
                .fg(Color::White)
                .bg(self.accent_rose)
                .add_modifier(Modifier::BOLD),
            _ => Style::default()
                .fg(self.text_main)
                .bg(self.card_border)
                .add_modifier(Modifier::BOLD),
        }
    }

    pub fn card_style(&self) -> Style {
        Style::default().fg(self.text_main).bg(self.card_bg)
    }

    pub fn border_style(&self) -> Style {
        Style::default().fg(self.card_border)
    }

    pub fn prompt_prefix_style(&self) -> Style {
        Style::default()
            .fg(self.pln_emerald)
            .add_modifier(Modifier::BOLD)
    }
}
