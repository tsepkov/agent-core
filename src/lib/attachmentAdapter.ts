"use client";

import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  type AttachmentAdapter,
  type PendingAttachment,
  type CompleteAttachment,
} from "@assistant-ui/react";

const ACCEPTED_DOCS =
  "application/pdf," +
  "application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-excel," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.ms-powerpoint," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation," +
  "text/plain,text/markdown,text/csv";

async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

class FileAttachmentAdapter implements AttachmentAdapter {
  accept = ACCEPTED_DOCS;

  async add(state: { file: File }): Promise<PendingAttachment> {
    return {
      id: state.file.name,
      type: "document",
      name: state.file.name,
      contentType: state.file.type,
      file: state.file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const dataUrl = await fileToDataURL(attachment.file);
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "file",
          data: base64,
          mimeType: attachment.contentType ?? "application/octet-stream",
        },
      ],
    };
  }

  async remove(): Promise<void> {}
}

export const compositeAttachmentAdapter = new CompositeAttachmentAdapter([
  new SimpleImageAttachmentAdapter(),
  new FileAttachmentAdapter(),
]);
