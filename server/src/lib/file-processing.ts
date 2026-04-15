import { read, utils } from 'xlsx';
import { supabase } from './supabase.js';
import type { ContentBlock } from './anthropic.js';

export interface FileAttachment {
  fileName: string;
  mimeType: string;
  storagePath: string;
  size: number;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const TEXT_TYPES = ['text/csv', 'text/plain', 'text/markdown', 'text/yaml', 'application/json'];
const ALL_ALLOWED_TYPES = [
  ...IMAGE_TYPES,
  ...TEXT_TYPES,
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export async function buildContentBlocks(
  attachments: FileAttachment[],
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];

  for (const att of attachments) {
    if (!ALL_ALLOWED_TYPES.includes(att.mimeType)) {
      blocks.push({
        type: 'text',
        text: `[Rejected file with disallowed type: ${att.fileName} (${att.mimeType})]`,
      });
      continue;
    }

    const { data, error } = await supabase.storage
      .from('chat-attachments')
      .download(att.storagePath);

    if (error || !data) {
      console.error(`[FileProcessing] Failed to download ${att.storagePath}:`, error);
      blocks.push({
        type: 'text',
        text: `[Failed to load file: ${att.fileName}]`,
      });
      continue;
    }

    if (IMAGE_TYPES.includes(att.mimeType)) {
      const buffer = Buffer.from(await data.arrayBuffer());
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: att.mimeType,
          data: buffer.toString('base64'),
        },
      });
    } else if (att.mimeType === 'application/pdf') {
      const buffer = Buffer.from(await data.arrayBuffer());
      blocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: buffer.toString('base64'),
        },
      });
    } else if (
      att.mimeType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      try {
        const buffer = Buffer.from(await data.arrayBuffer());
        const workbook = read(buffer);
        const csvParts: string[] = [];
        for (const sheetName of workbook.SheetNames) {
          const csv = utils.sheet_to_csv(workbook.Sheets[sheetName]);
          csvParts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
        }
        blocks.push({
          type: 'text',
          text: `${att.fileName}:\n${csvParts.join('\n\n')}`,
        });
      } catch (err) {
        console.error(`[FileProcessing] Failed to parse XLSX ${att.fileName}:`, err);
        blocks.push({
          type: 'text',
          text: `[Failed to parse spreadsheet: ${att.fileName}]`,
        });
      }
    } else if (TEXT_TYPES.includes(att.mimeType)) {
      const text = await data.text();
      blocks.push({
        type: 'text',
        text: `${att.fileName}:\n${text}`,
      });
    } else {
      blocks.push({
        type: 'text',
        text: `[Unsupported file type: ${att.fileName} (${att.mimeType})]`,
      });
    }
  }

  return blocks;
}
