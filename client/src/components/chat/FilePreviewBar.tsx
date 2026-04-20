import { X, FileText } from 'lucide-react';
import { formatFileSize, isImageType, type PendingFile } from '@/lib/file-upload';

interface FilePreviewBarProps {
  files: PendingFile[];
  onRemove: (id: string) => void;
}

export function FilePreviewBar({ files, onRemove }: FilePreviewBarProps) {
  if (files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-3 py-2 border-b bg-muted/30">
      {files.map((pf) => (
        <div
          key={pf.id}
          className="group relative flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-xs shadow-sm"
        >
          {isImageType(pf.file.type) && pf.previewUrl ? (
            <img
              src={pf.previewUrl}
              alt={pf.file.name}
              className="h-8 w-8 rounded object-cover"
            />
          ) : (
            <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0">
            <p className="truncate max-w-[120px] font-medium">{pf.file.name}</p>
            <p className="text-muted-foreground">{formatFileSize(pf.file.size)}</p>
          </div>
          <button
            type="button"
            onClick={() => onRemove(pf.id)}
            className="ml-1 rounded-full p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={`Remove ${pf.file.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
