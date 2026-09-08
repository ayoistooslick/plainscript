// crates/pln-repl/src/logo.rs
// Canonical PlainScript Logo Terminal Art using ratatui-image (chafa/halfblocks protocol)
// and Unicode fallback rendering.

use image::DynamicImage;
use ratatui::{
    buffer::Buffer,
    layout::{Alignment, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, StatefulWidget, Widget},
};
use ratatui_image::{picker::Picker, protocol::StatefulProtocol, Image, Resize};

// Embedded canonical logo image (green square with bold white PLN in bottom right)
pub const LOGO_BYTES: &[u8] = include_bytes!("../../../assets/logo.png");

pub struct LogoWidget {
    image: Option<Box<dyn StatefulProtocol>>,
}

impl LogoWidget {
    pub fn new() -> Self {
        // Attempt to load and prepare terminal image protocol (Kitty, Sixel, Halfblocks, iTerm2)
        let protocol = match image::load_from_memory(LOGO_BYTES) {
            Ok(dyn_img) => {
                let mut picker = Picker::from_query_stdio().unwrap_or_else(|_| Picker::halfblocks());
                picker.new_resize_protocol(dyn_img).ok()
            }
            Err(_) => None,
        };

        Self { image: protocol }
    }

    pub fn render_fallback(&self, area: Rect, buf: &mut Buffer) {
        // High-fidelity Unicode Block Logo:
        // Solid green background with bold white PLN in bottom-right corner
        let bg_green = Color::Rgb(46, 164, 79);
        let text_white = Color::Rgb(255, 255, 255);

        let lines = vec![
            Line::from(vec![
                Span::styled("  ╭───────────────╮  ", Style::default().fg(bg_green)),
            ]),
            Line::from(vec![
                Span::styled("  │               │  ", Style::default().fg(bg_green)),
            ]),
            Line::from(vec![
                Span::styled("  │       ", Style::default().fg(bg_green)),
                Span::styled("P L N", Style::default().fg(text_white).bg(bg_green).add_modifier(Modifier::BOLD)),
                Span::styled("   │  ", Style::default().fg(bg_green)),
            ]),
            Line::from(vec![
                Span::styled("  ╰───────────────╯  ", Style::default().fg(bg_green)),
            ]),
        ];

        let p = Paragraph::new(lines).alignment(Alignment::Center);
        p.render(area, buf);
    }
}

impl StatefulWidget for LogoWidget {
    type State = ();

    fn render(mut self, area: Rect, buf: &mut Buffer, _state: &mut Self::State) {
        if let Some(ref mut proto) = self.image {
            let img_widget = Image::new(proto.as_ref()).resize(Resize::Fit(None));
            img_widget.render(area, buf);
        } else {
            self.render_fallback(area, buf);
        }
    }
}
