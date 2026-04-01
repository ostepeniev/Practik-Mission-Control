import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    enabled: process.env.NODE_ENV === 'production',
    
    // Replay for debugging user issues
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.5,
    
    ignoreErrors: [
      'ResizeObserver loop',
      'Non-Error promise rejection',
      'AbortError',
    ],

    initialScope: {
      tags: { app: 'practik-dashboard' },
    },
  });
}
