import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Tensor} from '@huggingface/transformers';
import {generateTokens} from '../src/chat/generation.ts';

test('long prompts use valid LFM3 WebGPU chunks, absolute positions and one logit',async()=>{
  const calls:{length:number;position:number;mask:number}[]=[];
  const model={forward:async(inputs:Record<string,any>)=>{
    calls.push({length:inputs.input_ids.dims[1],position:Number(inputs.position_ids.data[0]),mask:inputs.attention_mask.dims[1]});
    assert.equal(inputs.logits_to_keep.data[0],1n);
    assert.deepEqual(inputs.logits_to_keep.dims,[1]);
    // Emit token 1 after prefill, then EOS (2).
    return {logits:new Tensor('float32',calls.length===4?[0,0,10]:[0,10,0],[1,1,3])};
  }};
  const result=await generateTokens(model,Array(600).fill(1n),{eos:2,maxTokens:10,stopped:()=>false});
  assert.deepEqual(calls,[{length:256,position:0,mask:256},{length:256,position:256,mask:512},{length:88,position:512,mask:600},{length:1,position:600,mask:601}]);
  assert.deepEqual(result,{tokens:[1n],truncated:false});
});
test('stop during prefill prevents further model work and output',async()=>{
  let stopped=false,calls=0;
  const model={forward:async()=>{calls++;return {logits:new Tensor('float32',[0,10,0],[1,1,3])};}};
  const result=await generateTokens(model,Array(600).fill(1n),{eos:2,maxTokens:10,stopped:()=>stopped,progress:()=>{stopped=true;}});
  assert.equal(calls,1);assert.deepEqual(result.tokens,[]);
});
test('the response limit is reported instead of silently claiming completion',async()=>{
  const model={forward:async()=>({logits:new Tensor('float32',[0,10,0],[1,1,3])})};
  const result=await generateTokens(model,[1n],{eos:2,maxTokens:3,stopped:()=>false});
  assert.equal(result.truncated,true);assert.equal(result.tokens.length,3);
});
