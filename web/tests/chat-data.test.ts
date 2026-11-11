import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {answerPlan,parsePlan,plannerRequest,isFollowup,explanationTopic} from '../src/chat/data.ts';
const catalog=JSON.parse(readFileSync(new URL('../public/data/corpora.json',import.meta.url),'utf8'));
const plan=(extra:object)=>parsePlan(JSON.stringify({view:'size',languages:[],...extra}),catalog);

test('size answers use exact release counts, not model-supplied values',()=>{
  const answer=answerPlan(plan({metric:'tokens',values:[123]}),catalog);
  const swedish=catalog.datasets.find((d:any)=>d.id==='swedish');
  assert.deepEqual(answer.rows[0],{label:'Swedish',value:swedish.tokens});
  assert.equal(answer.rows.length,5);
  assert.ok(answer.sources.every(s=>s.url.includes('/resolve/')));
});
test('missing Swedish coverage stays unknown, including percentage mode',()=>{
  for(const scale of ['count','share']){
    const answer=answerPlan(plan({view:'coverage',languages:['swedish'],metric:'records',scale}),catalog);
    assert.equal(answer.rows[0].value,null);
    assert.match(answer.text,/not published/);
  }
});
test('annotation percentages include unreported records and sum to 100',()=>{
  const answer=answerPlan(plan({view:'annotations',languages:['danish'],metric:'records',scale:'share'}),catalog);
  assert.ok(answer.rows.some(r=>r.label==='Unreported'&&r.value!>0));
  assert.ok(Math.abs(answer.rows.reduce((sum,r)=>sum+r.value!,0)-100)<0.00001);
});
test('limited source chart retains the whole corpus denominator',()=>{
  const answer=answerPlan(plan({view:'sources',languages:['danish'],metric:'tokens',scale:'share',limit:3}),catalog);
  const danish=catalog.datasets.find((d:any)=>d.id==='danish');
  const top=[...danish.sources].sort((a:any,b:any)=>b.tokens-a.tokens)[0];
  assert.equal(answer.rows.length,3);
  assert.equal(answer.rows[0].value,100*top.tokens/danish.tokens);
  assert.ok(answer.rows.reduce((sum,r)=>sum+r.value!,0)<100);
});
test('unknown language and invented domain cannot silently become all corpora',()=>{
  assert.throws(()=>plan({languages:['finnish']}));
  assert.throws(()=>plan({domain:'Finance'}));
  assert.throws(()=>plan({metric:'billions'}));
});
test('language capitalization from model output does not change selection',()=>{
  const answer=answerPlan(plan({languages:['Danish'],metric:'tokens'}),catalog);
  assert.equal(answer.rows.length,1);
  assert.equal(answer.rows[0].label,'Danish');
});
test('unsupported annotation measures and ambiguous distributions ask for clarification',()=>{
  assert.throws(()=>answerPlan(plan({view:'annotations',languages:['danish'],metric:'tokens'}),catalog),/count records/);
  assert.throws(()=>answerPlan(plan({view:'annotations',metric:'records'}),catalog),/Which language/);
});
test('search explanation distinguishes indexed and comparison releases',()=>{
  const answer=answerPlan(plan({view:'about',topic:'search'}),catalog);
  assert.ok(answer.text.includes(catalog.indexed_danish.version));
  assert.ok(answer.text.includes(catalog.datasets.find((d:any)=>d.id==='danish').version));
});
test('fenced JSON is accepted, while arbitrary output is rejected',()=>{
  assert.equal(parsePlan('```json\n{"view":"size","languages":[]}\n```',catalog).view,'size');
  assert.throws(()=>parsePlan('Run this JavaScript: alert(1)',catalog));
});
test('model extraction maps quality percentages to annotation records',()=>{
  const p=parsePlan(JSON.stringify({measure:'content_quality',group_by:'category',languages:['danish'],as_percent:true,chart:true}),catalog);
  assert.equal(p.view,'annotations');assert.equal(p.metric,'records');assert.equal(p.scale,'share');assert.equal(p.format,'chart');
  assert.ok(answerPlan(p,catalog).rows.some(r=>r.label==='Good'));
});
test('conversation context preserves a resolved request in the model schema',()=>{
  const p=plan({view:'sources',languages:['danish'],metric:'tokens',limit:5,format:'chart'});
  assert.deepEqual(parsePlan(JSON.stringify(plannerRequest(p)),catalog),p);
});
test('explicit language and percentage selections survive omitted model fields',()=>{
  const p=parsePlan('{"measure":"content_quality","chart":true}',catalog,'Plot Danish content quality as percentages');
  assert.deepEqual(p.languages,['danish']);assert.equal(p.scale,'share');assert.equal(p.view,'annotations');
  const answer=answerPlan(p,catalog);
  assert.ok(Math.abs(answer.rows.reduce((sum,r)=>sum+r.value!,0)-100)<0.00001);
});
test('a short follow-up retains the previous language and chart selection',()=>{
  const previous=plan({view:'sources',languages:['danish'],metric:'tokens',limit:5,format:'chart'});
  const p=parsePlan('{"measure":"records"}',catalog,'And by record count?',previous);
  assert.deepEqual(p.languages,['danish']);assert.equal(p.view,'sources');assert.equal(p.metric,'records');assert.equal(p.format,'chart');assert.equal(p.limit,5);
});
test('explicit source ranking size and measure cannot be dropped by the model',()=>{
  const p=parsePlan('{"measure":"records"}',catalog,'Show the top 5 Danish sources by tokens');
  assert.equal(p.view,'sources');assert.equal(p.metric,'tokens');assert.equal(p.limit,5);
  assert.equal(answerPlan(p,catalog).rows.length,5);
});
test('known definition questions use documented facts even if the model emits prose',()=>{
  const p=parsePlan('Dynaword is a collection...',catalog,'What is Dynaword?');
  assert.equal(p.view,'about');assert.equal(p.topic,'dynaword');
  assert.equal(explanationTopic('What is the Danish token count?'),undefined);
});
test('new questions do not inherit an unrelated prior conversation topic',()=>{
  assert.equal(isFollowup('What is Dynaword?'),false);
  assert.equal(isFollowup('Plot Danish domains'),false);
  assert.equal(isFollowup('And Swedish?'),true);
});
