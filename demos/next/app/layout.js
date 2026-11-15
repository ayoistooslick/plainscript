import "./globals.css";

export const metadata = { title: "PlainScript + Next.js" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
