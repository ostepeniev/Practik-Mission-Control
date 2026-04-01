import './globals.css';
import ClientBody from './components/ClientBody';

export const metadata = {
  title: "Practik UA Dashboard",
  description: "Аналітична платформа для Practik UA — виробництво та продажі кормів",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="uk">
      <body>
        <ClientBody>{children}</ClientBody>
      </body>
    </html>
  );
}
