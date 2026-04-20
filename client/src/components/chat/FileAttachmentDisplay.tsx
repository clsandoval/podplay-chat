import { useState } from 'react';
import { FileText } from 'lucide-react';
import { formatFileSize, isImageType } from '@/lib/file-upload';
import { ImageModal } from './ImageModal';
import type { MessageAttachment } from './MessageBubble';

interface FileAttachmentDisplayProps {
  attachments: MessageAttachment[];
  isUser: boolean;
}

export function FileAttachmentDisplay({
  attachments,
  isUser,
}: FileAttachmentDisplayProps) {
  const [modalImage, setModalImage] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => isImageType(a.mimeType));
  const docs = attachments.filter((a) => !isImageType(a.mimeType));

  return (
    <>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-1.5">
          {images.map((att, i) => (
            <button
              key={`img-${att.fileName}-${i}`}
              type="button"
              onClick={() => setModalImage(att.url)}
              className="block rounded-md overflow-hidden border hover:opacity-80 transition-opacity"
            >
              <img
                src={att.url}
                alt={att.fileName}
                className="h-32 max-w-[200px] object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {docs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {docs.map((att, i) => (
            <div
              key={`doc-${att.fileName}-${i}`}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                isUser
                  ? 'border-primary-foreground/20 text-primary-foreground/80'
                  : 'border-border text-muted-foreground'
              }`}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-[120px]">{att.fileName}</span>
              <span className="text-[10px] opacity-60">
                {formatFileSize(att.size)}
              </span>
            </div>
          ))}
        </div>
      )}

      {modalImage && (
        <ImageModal
          src={modalImage}
          alt="Full size image"
          onClose={() => setModalImage(null)}
        />
      )}
    </>
  );
}
