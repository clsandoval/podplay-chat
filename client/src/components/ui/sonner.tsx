import { Toaster as Sonner } from 'sonner';

export function Toaster() {
  return (
    <Sonner
      position="top-right"
      toastOptions={{
        duration: 3000,
        classNames: {
          toast: 'font-sans text-sm',
        },
      }}
    />
  );
}
