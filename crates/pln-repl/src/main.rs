// crates/pln-repl/src/main.rs
// Entry point for the PlainScript Agentic REPL.

mod app;
mod bridge;
mod logo;
mod theme;
mod ui;

use app::App;
use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::io;
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Terminal setup
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new();

    // Main event loop
    loop {
        app.poll_bridge();

        terminal.draw(|f| ui::draw(f, &mut app))?;

        if app.should_quit {
            break;
        }

        // Poll keyboard input with 50ms timeout for smooth response
        if event::poll(Duration::from_millis(50))? {
            if let Event::Key(key) = event::read()? {
                // Global exit: Ctrl+C or Ctrl+D
                if (key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c'))
                    || (key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('d'))
                {
                    break;
                }

                match key.code {
                    KeyCode::Char(c) => app.handle_char(c),
                    KeyCode::Backspace => app.handle_backspace(),
                    KeyCode::Delete => app.handle_delete(),
                    KeyCode::Left => app.move_cursor_left(),
                    KeyCode::Right => app.move_cursor_right(),
                    KeyCode::Tab => app.next_tab(),
                    KeyCode::Enter => app.submit(),
                    KeyCode::Esc => {
                        app.input.clear();
                        app.cursor_pos = 0;
                    }
                    _ => {}
                }
            }
        }
    }

    // Terminal teardown
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    Ok(())
}
