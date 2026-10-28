const directQuote = String.raw`(?:“[^“”]*”|‘[^‘’]*’|「[^「」]*」|『[^『』]*』|«[^«»]*»|‹[^‹›]*›|〝[^〝〞]*〞|＂[^＂]*＂|＇[^＇]*＇|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')`;
const leadingQuote = new RegExp('^\\s*(' + directQuote + ')', 'u');
const trailingQuote = new RegExp('(' + directQuote + ')\\s*$', 'u');
const trailingQuoteWithStop = new RegExp('(' + directQuote + ')([\\p{L}]{0,13}[。！？!?]+)\\s*$', 'u');
const quoteKey = value => value.replace(/\s|…|\.{3,}/gu, '');

function trimSubjectAcrossSound(source, replacement, replacements, ranges, rewritten) {
    const original = source.slice(replacement.start, replacement.end);
    const action = original.match(/^一声([^，,。！？!?；;\r\n]{4,40})(?=[，,。！？!?；;])/u)?.[1];
    if (!action) return rewritten;
    const position = rewritten.indexOf(action);
    const subject = rewritten.slice(0, position);
    if (position < 2 || !/^[\p{L}]{2,12}$/u.test(subject)) return rewritten;
    const before = source.slice(0, replacement.start), quote = before.match(trailingQuote);
    if (!quote || !/^[\p{L}]{1,8}$/u.test(quote[1].slice(1, -1))) return rewritten;
    const quoteStart = quote.index + quote[0].indexOf(quote[1]);
    const left = before.slice(0, quoteStart).trimEnd();
    if (!left.endsWith(subject) || !ranges.some(range => range.start === quoteStart && range.end === quoteStart + quote[1].length)) return rewritten;
    const anchorStart = left.length - subject.length;
    if (ranges.some(range => range.start < left.length && range.end > anchorStart)
        || replacements.some(other => other !== replacement && other.start < replacement.start && other.end > anchorStart
            && String(other.rewritten ?? '') !== source.slice(other.start, other.end))) return rewritten;
    // Only the added subject is removed; the original action prefix must still be exact.
    return rewritten.slice(position);
}

function trimCompletedQuotedTerm(source, replacement, replacements, ranges) {
    const original = source.slice(replacement.start, replacement.end);
    const rewritten = String(replacement.rewritten ?? '');
    // A naming fragment can end before a protected term, not before speech.
    // Only trim a proven copied noun + speech tail; never edit the retained source.
    if (!/(?:称之为|称为|叫作|叫做)$/u.test(original)) return rewritten;
    const following = source.slice(replacement.end, replacement.end + 800);
    const term = following.match(leadingQuote);
    if (!term || term.index !== 0 || !/^[\p{L}\p{N}]{1,12}$/u.test(term[1].slice(1, -1))) return rewritten;
    const bridge = following.slice(term[0].length).match(/^的([\p{L}]{2,12})[，,]/u);
    if (!bridge) return rewritten;
    const speechOffset = term[0].length + bridge[0].length;
    const speech = following.slice(speechOffset).match(leadingQuote);
    if (!speech || !/[。！？!?]/u.test(speech[1])) return rewritten;
    const end = replacement.end + speechOffset + speech[0].length;
    if (replacements.some(other => other !== replacement && other.start < end
        && other.end > replacement.end && String(other.rewritten ?? '') !== source.slice(other.start, other.end))) return rewritten;
    const termStart = replacement.end + term[0].indexOf(term[1]);
    const speechStart = replacement.end + speechOffset + speech[0].indexOf(speech[1]);
    if (![ [termStart, term[1]], [speechStart, speech[1]] ].every(([start, quote]) =>
        ranges.some(range => range.start === start && range.end === start + quote.length))) return rewritten;
    const copy = rewritten.match(trailingQuote);
    if (!copy || quoteKey(copy[1]) !== quoteKey(speech[1])) return rewritten;
    const beforeCopy = rewritten.slice(0, copy.index);
    const noun = bridge[1];
    const suffix = beforeCopy.match(/[，,]\s*$/u);
    if (!suffix || !beforeCopy.slice(0, suffix.index).endsWith(noun)) return rewritten;
    const kept = beforeCopy.slice(0, suffix.index - noun.length);
    // A new clause, quote, or missing narration makes the splice uncertain.
    if (!/[\p{L}\p{N}]$/u.test(kept) || /[。！？!?，,；;：:<>`]/u.test(kept)
        || protectedRanges(kept).length || original.includes(noun)) return rewritten;
    return kept;
}

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
        const subjectTrimmed = trimSubjectAcrossSound(source, replacement, replacements, ranges, rewritten);
        const completed = subjectTrimmed !== rewritten ? subjectTrimmed
            : trimCompletedQuotedTerm(source, replacement, replacements, ranges);
        let trimmed = completed !== rewritten;
        if (trimmed) { rewritten = completed; removedCount++; }
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
        // A model may copy either adjacent quote to either end of a narration target.
        for (const isStart of [true, false]) {
            while (true) {
                let copy = rewritten.match(isStart ? leadingQuote : trailingQuote);
                // A copied protected term may include a noun and terminal punctuation.
                // Accept only that exact retained suffix, never a new generated continuation.
                if (!copy && !isStart && !/[，,。.!！?？；;：:]\s*$/u.test(original)) {
                    const punctuated = rewritten.match(trailingQuoteWithStop);
                    if (punctuated) {
                        const following = source.slice(replacement.end);
                        const anchor = following.match(leadingQuote);
                        const stop = punctuated[2];
                        const end = replacement.end + (anchor?.[0].length || 0) + stop.length;
                        if (anchor && quoteKey(anchor[1]) === quoteKey(punctuated[1])
                            && following.slice(anchor[0].length).startsWith(stop)
                            && !replacements.some(other => other !== replacement && other.start < end
                                && other.end > replacement.end && String(other.rewritten ?? '') !== source.slice(other.start, other.end))) copy = punctuated;
                    }
                }
                if (!copy || !neighbors.includes(quoteKey(copy[1]))) break;
                const quoteStart = copy.index + copy[0].indexOf(copy[1]);
                const quoteEnd = quoteStart + copy[1].length;
                if (!protectedRanges(rewritten).some(range => range.start === quoteStart && range.end === quoteEnd)) break;
                let remaining = isStart ? rewritten.slice(copy[0].length) : rewritten.slice(0, copy.index);
                // Do not detach a quoted modifier from its noun (e.g. “确认”的印记).
                if (isStart && /^\s*的/u.test(remaining)) break;
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
        // Interior copies can relocate original facts after the quote. Cutting that
        // tail would lose information; retain this source target instead of guessing syntax.
        const interiorCopy = protectedRanges(rewritten).some(range => {
            const token = rewritten.slice(range.start, range.end);
            return new RegExp('^' + directQuote + '$', 'u').test(token)
                && neighbors.includes(quoteKey(token))
                && quoteKey(source.slice(replacement.end).match(leadingQuote)?.[1] || '') === quoteKey(token)
                && /[，,]\s*$/u.test(rewritten.slice(0, range.start))
                && /^\s*[，,]/u.test(rewritten.slice(range.end))
                && /[\p{L}\p{N}]/u.test(rewritten.slice(0, range.start))
                && /[\p{L}\p{N}]/u.test(rewritten.slice(range.end));
        });
        if (interiorCopy) return { ...replacement, rewritten: original, strategy: 'boundary-dialogue-rejected' };
        return trimmed ? { ...replacement, rewritten, strategy: 'boundary-dialogue-trimmed' } : replacement;
    });
    return { replacements: repaired, removedCount };
}
