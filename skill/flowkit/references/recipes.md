# FlowKit recipes

Multi-step workflows. Each step uses the `path` returned by the previous one (shown here as `<previous path>`). Run steps one at a time.

## Documents

**Read a Word document**
1. `flowkit_document_to_markdown({ inputPath: "report.docx" })`. The result has a 1,000-character `preview`.
2. If more is needed: `flowkit_read_text({ inputPath: <previous path>, offset: 0, limit: 6000 })`, then continue from `nextOffset`.

**Clean up and publish as an ebook**
1. `flowkit_document_to_markdown({ inputPath: "notes.docx" })`
2. `flowkit_clean_markdown({ inputPath: <previous path> })`
3. `flowkit_document_to_epub({ inputPath: <previous path> })`

**Combine chapters into one Word file:** `flowkit_merge_documents({ inputPaths: ["ch1.docx", "ch2.docx", "ch3.docx"] })`. Inputs must share a format, 2–10 files.

**Slides from an outline:** `flowkit_document_to_pptx({ inputPath: "outline.md" })`. Level-2 headings (`##`) start new slides.

## PDF

**Contract packet: merge, drop a page, shrink, protect**
1. `flowkit_pdf_merge({ inputPaths: ["cover.pdf", "terms.pdf"] })`
2. `flowkit_pdf_remove({ inputPath: <previous path>, pages: "2" })`
3. `flowkit_pdf_reduce({ inputPath: <previous path>, factor: 2 })`. Check `targetMet` and `achievedFactor`.
4. `flowkit_pdf_encrypt({ inputPath: <previous path>, passwordFilePath: "secret.txt" })`. The user provides `secret.txt`.

**Split a PDF into parts:** one `flowkit_pdf_extract` call per part, for example `pages: "1-5"`, then `pages: "6-10"`.

**Fix scanned pages that are sideways:** `flowkit_pdf_rotate({ inputPath: "scan.pdf", pages: "2,4", degrees: 90 })`. Rotation is clockwise and relative to the current rotation.

**Work on a protected PDF**
1. `flowkit_file_metadata({ inputPath: "locked.pdf" })` and check `details.encrypted`.
2. `flowkit_pdf_decrypt({ inputPath: "locked.pdf", passwordFilePath: "password.txt" })`
3. Continue with other PDF tools on the decrypted `path`.

**Sign last**
- Visible signature: `flowkit_pdf_sign({ inputPath: <previous path>, signatureImagePath: "signature.png", page: 1, x: 400, y: 60, width: 160, height: 60 })`. Coordinates are PDF points from the bottom-left.
- Digital signature: `flowkit_pdf_sign({ inputPath: <previous path>, mode: "certificate", certificatePath: "me.p12", certificatePasswordFilePath: "p12-password.txt" })`

## Images

**Web thumbnail**
1. `flowkit_image_resize({ inputPath: "photo.jpg", width: 800, height: 800 })`. Fits inside the box and keeps the aspect ratio.
2. `flowkit_image_convert({ inputPath: <previous path>, format: "jpeg", quality: 85 })`

**Crop then straighten:** `flowkit_image_crop({ inputPath: "scan.png", x: 40, y: 40, width: 1200, height: 900 })`, then `flowkit_image_rotate({ inputPath: <previous path>, degrees: 90 })`.

## Audio and video

**Podcast clip from a recorded talk**
1. `flowkit_video_extract_audio({ inputPath: "talk.mp4", format: "mp3" })`
2. `flowkit_audio_trim({ inputPath: <previous path>, startSeconds: 60, durationSeconds: 90 })`
3. `flowkit_audio_normalize({ inputPath: <previous path>, targetLufs: -16 })`
4. Optional: `flowkit_audio_fade({ inputPath: <previous path>, fadeInSeconds: 1, fadeOutSeconds: 2 })`

**Short social clip**
1. `flowkit_video_trim({ inputPath: "clip.mov", startSeconds: 12, durationSeconds: 20 })`
2. `flowkit_video_resize({ inputPath: <previous path>, width: 720 })`
3. Optional: `flowkit_video_mute({ inputPath: <previous path> })`

**Check a file before processing:** `flowkit_file_metadata({ inputPath: "clip.mov" })` returns duration, resolution, frame rate, and codecs. Sources over 5 minutes, 1080p, or 60 fps are rejected, so tell the user rather than retrying.
