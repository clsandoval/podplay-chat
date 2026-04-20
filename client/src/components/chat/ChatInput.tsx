import { useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Send, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FilePreviewBar } from './FilePreviewBar';
import {
  validateFile,
  createPendingFile,
  revokePendingFile,
  ACCEPT_STRING,
  type PendingFile,
} from '@/lib/file-upload';

interface ChatInputProps {
  onSend: (text: string, files: PendingFile[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export interface ChatInputHandle {
  addFiles: (files: File[]) => void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    {
      onSend,
      disabled = false,
      placeholder = 'Ask PodPlay anything...',
    }: ChatInputProps,
    ref,
  ) {
    const [value, setValue] = useState('');
    const [files, setFiles] = useState<PendingFile[]>([]);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addFiles = useCallback(
      (incoming: File[]) => {
        setFiles((prev) => {
          let current = prev;
          for (const file of incoming) {
            const error = validateFile(file, current.length);
            if (error) {
              toast.error(error);
              continue;
            }
            current = [...current, createPendingFile(file)];
          }
          return current;
        });
      },
      [],
    );

    useImperativeHandle(ref, () => ({
      addFiles: (incoming: File[]) => addFiles(incoming),
    }));

    const removeFile = useCallback((id: string) => {
      setFiles((prev) => {
        const target = prev.find((f) => f.id === id);
        if (target) revokePendingFile(target);
        return prev.filter((f) => f.id !== id);
      });
    }, []);

    const handleSubmit = useCallback(() => {
      const trimmed = value.trim();
      if (!trimmed && files.length === 0) return;
      if (disabled) return;
      onSend(trimmed, files);
      setValue('');
      setFiles([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }, [value, files, disabled, onSend]);

    function handleKeyDown(e: React.KeyboardEvent) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    }

    function handleInput() {
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 200) + 'px';
      }
    }

    function handlePaste(e: React.ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        addFiles(imageFiles);
      }
    }

    function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
      const selected = e.target.files;
      if (selected) {
        addFiles(Array.from(selected));
      }
      // Reset so the same file can be re-selected
      e.target.value = '';
    }

    return (
      <div className="border-t bg-background px-4 py-3">
        <div className="max-w-[800px] mx-auto">
          <FilePreviewBar files={files} onRemove={removeFile} />
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT_STRING}
              onChange={handleFileInputChange}
              className="hidden"
              aria-label="Attach files"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault();
              }}
              disabled={disabled}
              className="shrink-0"
              aria-label="Attach files"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                handleInput();
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              className="flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            <Button
              size="icon"
              onClick={handleSubmit}
              disabled={disabled || (!value.trim() && files.length === 0)}
              className="shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  },
);
