import { getDocumentProxy, getResolvedPDFJS } from "unpdf";

/**
 * Extracts text from a PDF and separates what a HUMAN can see from text that
 * is hidden from humans but readable by an AI (white text, tiny fonts, off-page text).
 * This is the #1 real-world attack on AI resume screening.
 */
export type PdfExtraction = {
  visibleText: string;
  hiddenText: string;
  hiddenReasons: string[];
  pages: number;
};

const MIN_VISIBLE_FONT = 4; // pt — below this a human can't read it
const LIGHT = 0.9; // fill color brighter than this (0..1) on a white page = invisible

function hexToLum(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export async function extractPdf(data: Uint8Array): Promise<PdfExtraction> {
  const pdfjs = await getResolvedPDFJS();
  const OPS = pdfjs.OPS;
  const pdf = await getDocumentProxy(data);

  const visible: string[] = [];
  const hidden: string[] = [];
  const reasons = new Set<string>();

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const [x0, y0, x1, y1] = page.view;
    const ops = await page.getOperatorList();

    let fillLum = 0; // default fill is black
    let fontSize = 12;
    let textMatrix = [1, 0, 0, 1, 0, 0];
    let lineVisible: string[] = [];
    let lineHidden: string[] = [];

    const flush = () => {
      if (lineVisible.length) visible.push(lineVisible.join(""));
      if (lineHidden.length) hidden.push(lineHidden.join(""));
      lineVisible = [];
      lineHidden = [];
    };

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i] as unknown[];

      if (fn === OPS.setFillRGBColor) {
        const a = args[0];
        if (typeof a === "string") fillLum = hexToLum(a);
        else if (Array.isArray(args) && args.length >= 3)
          fillLum = 0.2126 * Number(args[0]) + 0.7152 * Number(args[1]) + 0.0722 * Number(args[2]);
      } else if (fn === OPS.setFillGray) {
        fillLum = Number(args[0]);
      } else if (fn === OPS.setFont) {
        fontSize = Math.abs(Number(args[1]) || fontSize);
      } else if (fn === OPS.setTextMatrix) {
        textMatrix = (args as number[]).slice(0, 6);
      } else if (fn === OPS.beginText) {
        flush();
      } else if (fn === OPS.showText || fn === OPS.showSpacedText) {
        const glyphs = (args[0] as unknown[]) ?? [];
        const text = glyphs
          .map((g) => (g && typeof g === "object" && "unicode" in g ? (g as { unicode: string }).unicode : typeof g === "number" && g < -200 ? " " : ""))
          .join("");
        if (!text.trim()) continue;

        const scale = Math.hypot(textMatrix[0], textMatrix[1]) || 1;
        const effSize = fontSize * scale;
        const tx = textMatrix[4];
        const ty = textMatrix[5];
        const offPage = tx < x0 - 5 || tx > x1 || ty < y0 - 5 || ty > y1;

        let why: string | null = null;
        if (fillLum >= LIGHT) why = "White / near-white text (invisible on a white page)";
        else if (effSize < MIN_VISIBLE_FONT) why = `Tiny text (${effSize.toFixed(1)}pt, unreadable for a human)`;
        else if (offPage) why = "Text placed outside the visible page";

        if (why) {
          reasons.add(why);
          lineHidden.push(text);
        } else {
          lineVisible.push(text);
        }
      }
    }
    flush();
  }

  return {
    visibleText: visible.join("\n").replace(/[ \t]+/g, " ").trim(),
    hiddenText: hidden.join("\n").replace(/[ \t]+/g, " ").trim(),
    hiddenReasons: [...reasons],
    pages: pdf.numPages,
  };
}
