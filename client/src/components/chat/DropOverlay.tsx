import { Upload } from 'lucide-react';

export function DropOverlay() {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg">
      <div className="flex flex-col items-center gap-2 text-primary">
        <Upload className="h-10 w-10" />
        <p className="text-sm font-medium">Drop files here</p>
      </div>
    </div>
  );
}
