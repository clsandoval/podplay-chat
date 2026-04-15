import { supabase } from './supabase';
import type { FileAttachment } from './api';

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_FILES = 5;
export const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/csv',
  'text/plain',
  'text/markdown',
  'text/yaml',
  'application/json',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export const ACCEPT_STRING = ALLOWED_TYPES.join(',');

export interface PendingFile {
  id: string;
  file: File;
  previewUrl?: string;
}

export function validateFile(
  file: File,
  currentCount: number,
): string | null {
  if (currentCount >= MAX_FILES) {
    return `Maximum ${MAX_FILES} files per message`;
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return `File type "${file.type || 'unknown'}" is not supported`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'File exceeds 10MB limit';
  }
  return null;
}

export function createPendingFile(file: File): PendingFile {
  const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const previewUrl = file.type.startsWith('image/')
    ? URL.createObjectURL(file)
    : undefined;
  return { id, file, previewUrl };
}

export function revokePendingFile(pending: PendingFile) {
  if (pending.previewUrl) {
    URL.revokeObjectURL(pending.previewUrl);
  }
}

export async function uploadFiles(
  files: PendingFile[],
  userId: string,
  sessionId: string,
): Promise<FileAttachment[]> {
  const attachments: FileAttachment[] = [];

  for (const pf of files) {
    const path = `${userId}/${sessionId}/${Date.now()}-${pf.file.name}`;
    const { error } = await supabase.storage
      .from('chat-attachments')
      .upload(path, pf.file);

    if (error) throw new Error(`Upload failed for ${pf.file.name}: ${error.message}`);

    attachments.push({
      fileName: pf.file.name,
      mimeType: pf.file.type,
      storagePath: path,
      size: pf.file.size,
    });
  }

  return attachments;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}
