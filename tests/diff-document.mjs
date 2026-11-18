import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderDiffDocument } from '../src/diff/compare.js';

test('full preview omits an unchanged second stage without mutating recorded text', () => {
    const pairs = [{section:'ai',oldText:'旧标题。正文。',newText:'新标题。正文。'},
        {section:'program',oldText:'新标题。正文。',newText:'新标题。正文。'}];
    const before = structuredClone(pairs);
    assert.equal(renderDiffDocument(pairs,'full').length,1);
    assert.deepEqual(pairs,before);
});
test('two changed stages produce one full body and keep their separate snippets', () => {
    const original = '甲。保留段落。复述。复述。尾声丁。';
    const intermediate = '乙。保留段落。复述。复述。尾声丁。';
    const final = '乙。保留段落。复述。复述。尾声丙。';
    const pairs = [
        {section:'ai',oldText:original,newText:intermediate,aiUnchanged:[{start:2,end:7,reason:'unchanged'}]},
        {section:'program',oldText:intermediate,newText:final},
    ];
    const before = structuredClone(pairs);
    const full = renderDiffDocument(pairs,'full');
    assert.equal(full.length,1);
    assert.match(full[0],/<mark[^>]*>保留段落。<\/mark>/u);
    assert.match(full[0],/data-blai-diff-section="combined"/u);
    assert.equal(full[0].replace(/<del\b[^>]*>.*?<\/del>/gsu,'').replace(/<[^>]+>/gu,''),final);
    const snippets = renderDiffDocument(pairs,'snippet').join('');
    assert.match(snippets,/data-blai-diff-section="ai"/u);
    assert.match(snippets,/data-blai-diff-section="program"/u);
    assert.deepEqual(pairs,before);
});

test('full preview retains a standalone unchanged record', () => {
    assert.equal(renderDiffDocument([{section:'program',oldText:'甲。',newText:'甲。'}],'full').length,1);
});
