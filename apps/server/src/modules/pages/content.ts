interface TiptapNode {
  type?: string;
  text?: string;
  content?: TiptapNode[];
}

const BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'tableRow', 'tableCell', 'tableHeader', 'horizontalRule',
]);

/** Validates that a string is a TipTap document and returns the parsed value. */
export function parseDoc(json: string): TiptapNode {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    throw new Error('contentJson is not valid JSON');
  }
  if (!doc || typeof doc !== 'object' || (doc as TiptapNode).type !== 'doc') throw new Error('contentJson must be a TipTap "doc" node');
  return doc as TiptapNode;
}

/** Extracts plain text from a TipTap document for the full-text search index. */
export function extractText(doc: TiptapNode): string {
  const parts: string[] = [];
  const walk = (n: TiptapNode) => {
    if (n.text) parts.push(n.text);
    n.content?.forEach(walk);
    if (n.type && BLOCK_TYPES.has(n.type)) parts.push('\n');
  };
  walk(doc);
  return parts.join(' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
