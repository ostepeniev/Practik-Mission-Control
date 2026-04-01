'use client';
import dynamic from 'next/dynamic';

const AIChatWidget = dynamic(() => import('./AIChatWidget'), { ssr: false });

export default function ClientBody({ children }) {
  return (
    <>
      {children}
      <AIChatWidget />
    </>
  );
}
