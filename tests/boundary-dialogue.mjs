import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trimCopiedBoundaryDialogue } from '../src/aiRewrite/boundaryDialogue.js';
const replace = (source, target, rewritten) => ({start: source.indexOf(target), end: source.indexOf(target) + target.length, rewritten});
const guard = (source, replacements) => {
    const before = structuredClone(replacements), result = trimCopiedBoundaryDialogue(source, replacements);
    assert.deepEqual(replacements, before);
    return { ...result, text: result.replacements.slice().sort((a,b)=>b.start-a.start).reduce((text,r)=>text.slice(0,r.start)+r.rewritten+text.slice(r.end),source) };
};
test('short dialogue copied before narration is removed without undoing simile cleanup', () => {
    const source='“别怕。”档案管理员的声音像是恶魔的低语，温柔地安抚着，“只是确认一下。”';
    const target='档案管理员的声音像是恶魔的低语，温柔地安抚着，';
    const result=guard(source,[replace(source,target,'“别怕。”档案管理员说道，')]);
    assert.equal(result.text,'“别怕。”档案管理员说道，“只是确认一下。”');assert.equal(result.removedCount,1);
});
test('copied next dialogue is removed while retaining the already cleaned narration', () => {
    const target='他的声音仿佛在远处传来，',source=target+'“先放松……再慢慢说。”';
    const result=guard(source,[replace(source,target,'他说道，“先放松再慢慢说。”')]);
    assert.equal(result.text,'他说道，“先放松……再慢慢说。”');assert.equal(result.removedCount,1);
});
for(const [open,close] of [['“','”'],['「','」'],['『','』'],['"','"'],["'","'"],['«','»']]) {
    test('short copy with '+open+close+' quote pair and boundary whitespace',()=>{
        const quote=open+'别怕。'+close,target='他轻声说道，',source=quote+'\n'+target;
        const result=guard(source,[replace(source,target,'  '+quote+'\n'+target)]);
        assert.equal(result.text,quote+'\n\n'+target);assert.equal(result.removedCount,1);
    });
}
test('both boundary copies and repeated added copies are trimmed locally',()=>{
    const target='他像秘书般回答，',source='“别怕。”'+target+'“继续。”';
    const result=guard(source,[replace(source,target,'“别怕。”“别怕。”他说道，“继续。”')]);
    assert.equal(result.text,'“别怕。”他说道，“继续。”');assert.equal(result.removedCount,3);
});
test('preexisting repeated speech, actions and normal counts are preserved',()=>{
    const target='他像秘书般回答，',source='“别怕。”“别怕。”'+target+'“拿两个杯子，再拿两条毛巾。”';
    const result=guard(source,[replace(source,target,'他拿起杯子，回答，')]);
    assert.equal(result.text,'“别怕。”“别怕。”他拿起杯子，回答，“拿两个杯子，再拿两条毛巾。”');assert.equal(result.removedCount,0);
});
test('quoted source targets are never deduplicated by this narration boundary guard',()=>{
    const source='“别怕。”“别怕。”',target=source.slice(5),result=guard(source,[replace(source,target,target)]);
    assert.equal(result.text,source);assert.equal(result.removedCount,0);
});
for(const source of ['```\n“别怕。”他像秘书般回答，\n```','<!--“别怕。”他像秘书般回答，-->','“他说‘别怕。’他像秘书般回答，”']) {
    test('enclosing code, comments or dialogue are protected: '+source.slice(0,15),()=>{
        const target='他像秘书般回答，',r=replace(source,target,'“别怕。”他说道，');
        assert.equal(guard(source,[r]).removedCount,0);
    });
}
test('different or nonadjacent dialogue is not treated as a proven copy',()=>{
    for(const [source,output] of [['“别怕。”他停下。他像秘书般回答，','“别怕。”他说道，'],['“别怕。”他像秘书般回答，','“别动。”他说道，']]){
        assert.equal(guard(source,[replace(source,'他像秘书般回答，',output)]).removedCount,0);
    }
});
test('a changed neighboring target cannot authorize deletion of dialogue',()=>{
    const target='他像秘书般回答，',source='“别怕。”'+target;
    const result=guard(source,[replace(source,'“别怕。”','“别动。”'),replace(source,target,'“别怕。”他说道，')]);
    assert.equal(result.removedCount,0);
});
test('a response consisting only of copied dialogue is not silently changed into deletion',()=>{
    const target='他像秘书般回答，',source='“别怕。”'+target;
    const result=guard(source,[replace(source,target,'“别怕。”')]);assert.equal(result.removedCount,0);
});
test('a quote inside generated code or an enclosing quote is not cut as boundary speech',()=>{
    const target='他像秘书般回答，';
    for(const [quote,output] of [['“别怕。”','```text\n他说道，“别怕。”'],['‘别怕。’','“转述他说道，‘别怕。’']]){
        const source=target+quote;
        assert.equal(guard(source,[replace(source,target,output)]).removedCount,0);
    }
});

test('the reported preceding dialogue copied after narration is removed together with its added colon',()=>{
    const quote='“管理员甲，放下它！”',target='档案管理员的声音里第一次出现了罕见的、近乎严厉的急切。';
    const source=quote+target,cleaned='档案管理员的声音里第一次出现了罕见的急切。';
    for(const connector of ['：',':',' ： ', '：:']){
        const result=guard(source,[replace(source,target,cleaned+connector+quote)]);
        assert.equal(result.text,quote+cleaned);assert.equal(result.removedCount,1);
    }
});

test('a following quote copied before narration is removed without touching the original quote',()=>{
    const target='他像秘书般回答，',quote='“先放松。”',source=target+quote;
    const result=guard(source,[replace(source,target,quote+'他回答，')]);
    assert.equal(result.text,'他回答，'+quote);assert.equal(result.removedCount,1);
});

test('all generated boundary copies can refer to either untouched source neighbor',()=>{
    const target='他像秘书般回答，',source='“别怕。”'+target+'“继续。”';
    const result=guard(source,[replace(source,target,'“继续。”他回答，：“别怕。”')]);
    assert.equal(result.text,'“别怕。”他回答，“继续。”');assert.equal(result.removedCount,2);
});

test('an added speech colon is removed and original terminal punctuation is restored when necessary',()=>{
    for(const ending of ['。','，','！','；']){
        const target='他像秘书般回答'+ending,source='“别怕。”'+target;
        assert.equal(guard(source,[replace(source,target,'他回答：“别怕。”')]).text,'“别怕。”他回答'+ending);
    }
});

test('a source speech colon before retained following dialogue is preserved',()=>{
    const target='他像秘书般回答：',source='“别怕。”'+target+'“继续。”';
    assert.equal(guard(source,[replace(source,target,'他回答：“别怕。”')]).text,'“别怕。”他回答：“继续。”');
});

test('cross-boundary removal remains conservative for changed neighbors, quoted source and copy-only responses',()=>{
    const target='他像秘书般回答。',quote='“别怕。”',source=quote+target;
    assert.equal(guard(source,[replace(source,quote,'“别动。”'),replace(source,target,'他回答：'+quote)]).removedCount,0);
    assert.equal(guard(source,[replace(source,target,'：'+quote)]).removedCount,0);
    const first=guard(source,[replace(source,target,'他回答。'+quote)]);
    assert.deepEqual(trimCopiedBoundaryDialogue(source,first.replacements),{replacements:first.replacements,removedCount:0});
});
