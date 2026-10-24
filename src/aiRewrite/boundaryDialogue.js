const directQuote = String.raw`(?:“[^“”]*”|‘[^‘’]*’|「[^「」]*」|『[^『』]*』|«[^«»]*»|‹[^‹›]*›|〝[^〝〞]*〞|＂[^＂]*＂|＇[^＇]*＇|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')`;
const leadingQuote = new RegExp('^\\s*(' + directQuote + ')', 'u');
const trailingQuote = new RegExp('(' + directQuote + ')\\s*$', 'u');
const quoteKey = value => value.replace(/\s|…|\.{3,}/gu, '');

export function protectedRanges(text) {
    // An enclosing quote, tag, comment or code block must not be mistaken for adjacent speech.
    const pattern = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\r\n]*(?:`|(?=\r?\n|$))|"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|“[^”]*(?:”|$)|‘[^’]*(?:’|$)|「[^」]*(?:」|$)|『[^』]*(?:』|$)|«[^»]*(?:»|$)|‹[^›]*(?:›|$)|〝[^〞]*(?:〞|$)|＂[^＂]*(?:＂|$)|＇[^＇]*(?:＇|$)|<!--[\s\S]*?(?:-->|$)|<[^>]*>/gu;
    return [...text.matchAll(pattern)].map(match => ({ start: match.index, end: match.index + match[0].length }));
}

export function trimCopiedBoundaryDialogue(sourceText, replacements) {
    const source = String(sourceText ?? '');
    const ranges = protectedRanges(source);
    let removedCount = 0;
    const repaired = replacements.map(replacement => {
        const original = source.slice(replacement.start, replacement.end);
        let rewritten = String(replacement.rewritten ?? '');
        // Only generated copies around an originally unquoted narration target can be removed.
        if (!original.trim() || /[“”‘’「」『』"'`<>«»‹›〝〞＂＇]/u.test(original)
            || ranges.some(range => range.start < replacement.end && replacement.start < range.end)) return replacement;
        const neighbors = [];
        for (const before of [true, false]) {
            const context = before ? source.slice(0, replacement.start) : source.slice(replacement.end);
            const neighbor = context.match(before ? trailingQuote : leadingQuote);
            if (!neighbor || !quoteKey(neighbor[1].slice(1, -1))) continue;
            const start = (before ? 0 : replacement.end) + neighbor.index + neighbor[0].indexOf(neighbor[1]);
            const end = start + neighbor[1].length;
            if (!ranges.some(range => range.start === start && range.end === end)
                || replacements.some(other => other.start < end && start < other.end
                    && String(other.rewritten ?? '') !== source.slice(other.start, other.end))) continue;
            neighbors.push(quoteKey(neighbor[1]));
        }
        let trimmed = false;
        // A model may copy either adjacent quote to either end of a narration target.
        for (const isStart of [true, false]) {
            while (true) {
                const copy = rewritten.match(isStart ? leadingQuote : trailingQuote);
                if (!copy || !neighbors.includes(quoteKey(copy[1]))) break;
                const quoteStart = copy.index + copy[0].indexOf(copy[1]);
                const quoteEnd = quoteStart + copy[1].length;
                if (!protectedRanges(rewritten).some(range => range.start === quoteStart && range.end === quoteEnd)) break;
                let remaining = isStart ? rewritten.slice(copy[0].length) : rewritten.slice(0, copy.index);
                if (!isStart) {
                    if (!/[:：]\s*$/u.test(original)) remaining = remaining.replace(/[ \t]*(?:[:：]\s*)+$/u, '');
                    const ending = original.match(/[，,。.!！?？；;：:]\s*$/u)?.[0].trim();
                    if (ending && !/[，,。.!！?？；;：:]\s*$/u.test(remaining)) remaining = remaining.trimEnd() + ending;
                }
                if (!/[\p{L}\p{N}]/u.test(remaining)) break;
                rewritten = remaining;
                removedCount++;
                trimmed = true;
            }
        }
        return trimmed ? { ...replacement, rewritten, strategy: 'boundary-dialogue-trimmed' } : replacement;
    });
    return { replacements: repaired, removedCount };
}
