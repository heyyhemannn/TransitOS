export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import ClientParentConfirmForm from './client-page';

export default function PayConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
          <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
        </div>
      }
    >
      <ClientParentConfirmForm />
    </Suspense>
  );
}
