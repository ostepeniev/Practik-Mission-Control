'use client';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';

const AIChatWidget = dynamic(() => import('./AIChatWidget'), { ssr: false });

/**
 * Page context mapping — визначає які suggestion chips і контекст
 * передаються AI чату залежно від поточної сторінки.
 */
function getPageContext(pathname) {
  // Product detail page: /products/123
  const productMatch = pathname.match(/^\/products\/(\d+)/);
  if (productMatch) {
    return {
      page: 'product_detail',
      productId: parseInt(productMatch[1]),
      label: 'Сторінка товару',
      suggestions: [
        'Проаналізуй динаміку цього товару',
        'Чому змінилась маржа?',
        'Покажи скарги по цьому товару',
        'Хто з менеджерів найбільше продає цей товар?',
      ],
    };
  }

  switch (pathname) {
    case '/':
      return {
        page: 'dashboard',
        label: 'Головний дашборд',
        suggestions: [
          'Яка загальна маржа за останній місяць?',
          'Покажи проблемні партії',
          'Топ-5 товарів по виторгу',
          'Порівняй канали продажів',
        ],
      };

    case '/complaints':
      return {
        page: 'complaints',
        label: 'Скарги та якість',
        suggestions: [
          'Скільки нових скарг за тиждень?',
          'Є кластери скарг по товарах?',
          'Які найчастіші причини скарг?',
          'Які товари мають найбільше повернень?',
        ],
      };

    case '/marketing':
      return {
        page: 'marketing',
        label: 'Маркетинг',
        suggestions: [
          'Який ROAS по каналах за останній тиждень?',
          'Порівняй ефективність Meta SHARK vs BUNTAR',
          'Тренд CAC за останні тижні',
          'Який канал приносить найбільше нових клієнтів?',
        ],
      };

    case '/admin':
      return {
        page: 'admin',
        label: 'Адмін-панель',
        suggestions: [
          'Покажи загальну статистику системи',
          'Які AI-інструменти використовувались найчастіше?',
        ],
      };

    default:
      return {
        page: 'unknown',
        label: 'Дашборд',
        suggestions: [
          'Яка загальна маржа за останній місяць?',
          'Покажи алерти',
          'Топ-5 товарів по виторгу',
        ],
      };
  }
}

export default function ClientBody({ children }) {
  const pathname = usePathname();
  const pageContext = getPageContext(pathname);

  return (
    <>
      {children}
      <AIChatWidget pageContext={pageContext} />
    </>
  );
}
