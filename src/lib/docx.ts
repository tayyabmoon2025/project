// Turns a generated quiz paper into a real Word file (.docx).
//
// A .docx is a ZIP archive of XML parts. The pieces below are the minimum Word needs
// to open a document: the content-types map, the package relationships, the document
// body, a styles part and the core properties. Everything is written uncompressed
// ("store"), which keeps the writer short and is perfectly valid, so no zip library
// is required.

import { SCHOOL_NAME } from '@/lib/noticeText';
import type { Paper } from '@/lib/quizPaper';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

// Word wants the CRC of every stored part in the archive headers.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipEntry = { name: string; data: Uint8Array };

function zip(entries: ZipEntry[], mimeType: string): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  const now = new Date();
  const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xffff;
  const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, entry.data);

    const header = new Uint8Array(46 + name.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x02014b50, true);
    headerView.setUint16(4, 20, true);
    headerView.setUint16(6, 20, true);
    headerView.setUint16(8, 0x0800, true);
    headerView.setUint16(10, 0, true);
    headerView.setUint16(12, time, true);
    headerView.setUint16(14, date, true);
    headerView.setUint32(16, crc, true);
    headerView.setUint32(20, entry.data.length, true);
    headerView.setUint32(24, entry.data.length, true);
    headerView.setUint16(28, name.length, true);
    headerView.setUint16(30, 0, true);
    headerView.setUint16(32, 0, true);
    headerView.setUint16(34, 0, true);
    headerView.setUint16(36, 0, true);
    headerView.setUint32(38, 0, true);
    headerView.setUint32(42, offset, true);
    header.set(name, 46);
    directory.push(header);

    offset += local.length + entry.data.length;
  }

  const directorySize = directory.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...parts, ...directory, end], { type: mimeType });
}

// XML 1.0 cannot carry most control characters, so they are dropped rather than escaped.
function keepXmlChars(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    out += char;
  }
  return out;
}

// Strips characters XML cannot carry and escapes the rest, so a stray ampersand or
// control character from the model cannot corrupt the file.
function esc(value: string): string {
  return keepXmlChars(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type ParaOptions = {
  align?: 'center' | 'right';
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: string;
  indent?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  keepNext?: boolean;
  underline?: boolean;
};

function para(text: string, options: ParaOptions = {}): string {
  const props: string[] = [];
  if (options.align) props.push(`<w:jc w:val="${options.align}"/>`);
  if (options.indent) props.push(`<w:ind w:left="${options.indent}"/>`);
  props.push(`<w:spacing w:before="${options.spaceBefore ?? 0}" w:after="${options.spaceAfter ?? 120}"/>`);
  if (options.keepNext) props.push('<w:keepNext/>');

  const run: string[] = [];
  if (options.bold) run.push('<w:b/>');
  if (options.italic) run.push('<w:i/>');
  if (options.underline) run.push('<w:u w:val="single"/>');
  if (options.color) run.push(`<w:color w:val="${options.color}"/>`);
  if (options.size) run.push(`<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>`);

  const runs = text
    .split('\n')
    .map((line, index) => `${index > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(line)}</w:t>`)
    .join('');

  return `<w:p><w:pPr>${props.join('')}</w:pPr><w:r>${run.length > 0 ? `<w:rPr>${run.join('')}</w:rPr>` : ''}${runs}</w:r></w:p>`;
}

// An empty paragraph with a bottom border, used as the line a pupil writes on.
function answerLine(): string {
  return '<w:p><w:pPr><w:spacing w:before="0" w:after="180"/><w:pBdr><w:bottom w:val="dotted" w:sz="6" w:space="1" w:color="94A3B8"/></w:pBdr></w:pPr></w:p>';
}

function pageBreak(): string {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

export type DocxImage = { base64: string; widthPx: number; heightPx: number };

// 96 pixels per inch, which is the scale Word uses for the sizes above.
const EMU_PER_PX = 9525;

// An inline picture paragraph. The namespaces are declared on the elements that use
// them so the document element does not have to carry every one.
function imageRun(relId: string, cx: number, cy: number): string {
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="120"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="School logo"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="School logo"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function documentXml(paper: Paper, logo: DocxImage | null): string {
  const body: string[] = [];

  // The uploaded logo sits above the school name, centred, the way a letterhead reads.
  if (logo) {
    body.push(imageRun('rId2', logo.widthPx * EMU_PER_PX, logo.heightPx * EMU_PER_PX));
  }

  body.push(para(SCHOOL_NAME, { align: 'center', bold: true, size: 22, spaceAfter: 40 }));
  body.push(para(paper.title, { align: 'center', bold: true, size: 32, spaceAfter: 60 }));

  const meta = [
    paper.subject && `Subject: ${paper.subject}`,
    paper.className && `Class: ${paper.className}`,
    paper.timeAllowed && `Time: ${paper.timeAllowed}`,
    paper.totalMarks && `Total marks: ${paper.totalMarks}`,
  ]
    .filter(Boolean)
    .join('     ');
  if (meta) body.push(para(meta, { align: 'center', size: 20, spaceAfter: 160 }));

  body.push(para('Name: ______________________________     Roll No.: ____________', { align: 'center', spaceAfter: 220 }));

  if (paper.instructions.length > 0) {
    body.push(para('Instructions', { bold: true, underline: true, spaceAfter: 60, keepNext: true }));
    for (const line of paper.instructions) body.push(para(`•  ${line}`, { indent: 360, size: 20, spaceAfter: 40 }));
  }

  paper.sections.forEach((section, sectionIndex) => {
    body.push(
      para(section.heading.toUpperCase(), {
        bold: true,
        size: 24,
        spaceBefore: sectionIndex === 0 ? 240 : 320,
        spaceAfter: 60,
        keepNext: true,
      }),
    );
    if (section.instructions) body.push(para(section.instructions, { italic: true, size: 20, spaceAfter: 100 }));
    section.questions.forEach((question, questionIndex) => {
      const isChoice = question.options.length > 0;
      body.push(
        para(`${questionIndex + 1}. ${question.question}${question.marks ? `  [${question.marks}]` : ''}`, {
          spaceAfter: isChoice ? 40 : 60,
          keepNext: isChoice,
        }),
      );
      for (const option of question.options) {
        body.push(para(option, { indent: 720, spaceAfter: 20, keepNext: true }));
      }
      if (!isChoice) body.push(answerLine());
    });
  });

  body.push(pageBreak());
  body.push(para('ANSWER KEY', { bold: true, size: 28, spaceAfter: 40 }));
  body.push(para(paper.title, { size: 20, color: '475569', spaceAfter: 220 }));
  paper.sections.forEach((section) => {
    body.push(para(section.heading, { bold: true, spaceBefore: 200, spaceAfter: 60 }));
    section.questions.forEach((question, index) => {
      body.push(para(`${index + 1}. ${question.answer || '—'}`, { spaceAfter: 40 }));
    });
  });

  body.push(
    para(`${SCHOOL_NAME} — generated with the School Assistant`, {
      align: 'center',
      size: 18,
      color: '64748B',
      spaceBefore: 400,
    }),
  );

  const section =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WORD_NS}"><w:body>${body.join('')}${section}</w:body></w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

function documentRels(hasLogo: boolean): string {
  const image = hasLogo
    ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${image}</Relationships>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${WORD_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

function coreXml(paper: Paper): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(paper.title)}</dc:title><dc:creator>${esc(SCHOOL_NAME)}</dc:creator><cp:lastModifiedBy>School Assistant</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function paperToDocx(paper: Paper, logo: DocxImage | null = null): Blob {
  const encoder = new TextEncoder();
  const parts = [
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
    { name: 'docProps/core.xml', data: encoder.encode(coreXml(paper)) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(documentRels(logo !== null)) },
    { name: 'word/document.xml', data: encoder.encode(documentXml(paper, logo)) },
    { name: 'word/styles.xml', data: encoder.encode(STYLES) },
  ];
  if (logo) parts.push({ name: 'word/media/logo.png', data: base64ToBytes(logo.base64) });
  return zip(parts, DOCX_MIME);
}

function safeFileName(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 80) || 'quiz-paper';
}

// Saves the paper as a Word file. Returns the name used, so the caller can confirm it.
export function downloadPaperDocx(paper: Paper, logo: DocxImage | null = null): string {
  const filename = `${safeFileName(paper.title)}.docx`;
  const url = URL.createObjectURL(paperToDocx(paper, logo));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}
