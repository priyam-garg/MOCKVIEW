// Shared PDF text extraction, used by both the resume-analysis and
// interview-resume-parsing routes (previously copy-pasted in both).
export async function extractPdfText(buffer: Buffer): Promise<string> {
    const PDFParser = (await import('pdf2json')).default;
    return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser(null, true); // true = extract text only

        pdfParser.on('pdfParser_dataError', (errData: { parserError: Error } | Error) =>
            reject('parserError' in errData ? errData.parserError : errData)
        );
        pdfParser.on('pdfParser_dataReady', () => {
            resolve(pdfParser.getRawTextContent());
        });

        pdfParser.parseBuffer(buffer);
    });
}
