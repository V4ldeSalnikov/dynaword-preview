import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assistantPrompt,conversationMessages,isStatisticsQuestion,resolveReply,visibleOutput} from '../src/chat/knowledge.ts';
import {parsePlan} from '../src/chat/data.ts';
const catalog=JSON.parse(readFileSync(new URL('../public/data/corpora.json',import.meta.url),'utf8'));

test('ordinary project answers are prose, not failed statistics requests',()=>{
  const {answer,plan}=resolveReply('Dynaword was developed collaboratively. Kenneth Enevoldsen is the paper’s first and corresponding author. [paper]',catalog,'Who developed Dynaword?');
  assert.equal(plan,undefined);
  assert.equal(answer.generated,true);
  assert.match(answer.text,/Kenneth Enevoldsen/);
  assert.equal(answer.rows.length,0);
  assert.equal(answer.sources[0].url,'https://aclanthology.org/2026.lrec-1.301/');
  assert.ok(!answer.text.includes('[paper]'));
});
test('source links come from known references, never model-supplied destinations',()=>{
  const {answer}=resolveReply('Read [invented] https://example.com/fake [tooling]',catalog,'How can I contribute?');
  assert.deepEqual(answer.sources.map(s=>s.url),['https://github.com/danish-foundation-models/dynaword']);
  const unverified=resolveReply('It was made by someone else. [imaginary]',catalog,'Who created it?').answer;
  assert.equal(unverified.sources.length,0);
  assert.match(unverified.notes[0],/did not cite/);
});
test('thinking blocks cannot become either visible prose or chart requests',()=>{
  assert.equal(visibleOutput('<think>private draft {"measure":"records"}</think>Final answer [paper]'),'Final answer [paper]');
  assert.equal(visibleOutput('reasoning</think>Answer'),'Answer');
  assert.throws(()=>resolveReply('<think>unfinished reasoning',catalog,'Who developed it?'),/before finishing/);
});
test('tagged chart requests retain exact validated statistics',()=>{
  const {answer,plan}=resolveReply('<data>{"measure":"tokens","group_by":"language","languages":[],"chart":true}</data>',catalog,'Plot token counts by language');
  assert.equal(plan?.view,'size');assert.equal(answer.format,'chart');
  assert.equal(answer.rows.length,5);
  assert.equal(answer.rows[0].value,catalog.datasets.find((d:any)=>d.id==='swedish').tokens);
  assert.equal(answer.generated,undefined);
});
test('malformed or unsafe data output is never treated as a chart or executed',()=>{
  assert.throws(()=>resolveReply('<data>{"measure":"tokens",</data>',catalog,'Plot tokens'));
  assert.throws(()=>resolveReply('<data>{"measure":"execute","languages":[]}</data>',catalog,'Plot tokens'));
});
test('text display preference does not disable numeric calculation',()=>{
  const {answer}=resolveReply('<data>{"measure":"records","languages":["danish"],"chart":true}</data>',catalog,'How many Danish records?',undefined,'text');
  assert.equal(answer.format,'text');assert.equal(answer.rows[0].value,catalog.datasets[0].records);
});
test('free-form follow-ups see recent answers and do not inherit an unrelated chart selection',()=>{
  const plan=parsePlan('{"measure":"tokens","languages":["danish"]}',catalog);
  const history=[{question:'Who developed Dynaword?',answer:'Kenneth Enevoldsen and collaborators. [paper]'}];
  const messages=conversationMessages('Which institutions were involved?',history,{question:'Plot Danish tokens',plan});
  assert.match(messages[1].content,/Kenneth Enevoldsen/);
  assert.ok(!messages.at(-1)!.content.includes('previous statistics selection'));
  assert.match(conversationMessages('And Swedish?',history,{question:'Plot Danish tokens',plan}).at(-1)!.content,/previous statistics selection/);
});
test('project prompt includes sourced authorship and the limits of its knowledge',()=>{
  const system=assistantPrompt(catalog);
  assert.match(system,/Kenneth Enevoldsen/);assert.match(system,/IT University of Copenhagen/);
  assert.match(system,/not a complete list of all dataset contributors/);
  assert.match(system,/If the notes do not answer the question/);
  assert.match(system,/Never guess numerical corpus statistics/);
});
test('chart requests use the tool prompt while definitions and authorship use prose',()=>{
  for(const q of ['Plot Danish content quality as percentages','How many Danish tokens are there?','Compare tokens across languages'])assert.equal(isStatisticsQuestion(q),true,q);
  for(const q of ['Who developed Dynaword?','What is annotation coverage?','Why are the token counts different?','How can I contribute?'])assert.equal(isStatisticsQuestion(q),false,q);
  const previous=parsePlan('{"measure":"tokens","languages":["danish"]}',catalog);
  assert.equal(isStatisticsQuestion('And who developed Dynaword?',previous),false);
  assert.equal(isStatisticsQuestion('And Swedish?',previous),true);
});
test('source questions get the selected published source list and a pinned citation',()=>{
  const prompt=assistantPrompt(catalog,'What sources does Danish Dynaword include?');
  const danish=catalog.datasets.find((d:any)=>d.id==='danish');
  assert.match(prompt,/\[danish_sources\]/);assert.ok(prompt.includes('cellar (Legal)'));
  assert.ok(!prompt.includes('[swedish_sources]'));
  const {answer}=resolveReply('It includes '+danish.sources[0].name+'. [danish_sources]',catalog,'What sources are included?');
  assert.equal(answer.sources[0].url,danish.url);
});
