// src/app/page.tsx — always land on /connect; let that page decide
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/connect');
}
