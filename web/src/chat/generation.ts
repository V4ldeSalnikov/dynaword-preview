import { DynamicCache, Tensor } from "@huggingface/transformers";

type Decoder = {forward:(inputs:Record<string,unknown>)=>Promise<Record<string,Tensor>>};

// The official LFM3 ONNX export needs logits_to_keep and WebGPU prefill chunks
// of at most 256 tokens. Transformers.js 4.3.2's generic generate() does neither.
// Keep its model loader/tokenizer, and drive the documented ONNX inputs here.
// https://huggingface.co/LiquidAI/LFM3-1.7B-ONNX
export async function generateTokens(model:Decoder,prompt:bigint[],options:{
  eos:number;maxTokens:number;stopped:()=>boolean;progress?:(stage:"reading"|"writing",tokens:number)=>void;
}):Promise<{tokens:bigint[];truncated:boolean}> {
  if(!prompt.length||prompt.length>6000)throw Error("This conversation is too long for the local assistant. Clear the chat and ask again.");
  const cache=new DynamicCache();
  const tokens:bigint[]=[];
  let position=0,logits:Tensor|undefined;
  const step=async(ids:bigint[])=>{
    const end=position+ids.length;
    const result=await model.forward({
      input_ids:new Tensor("int64",ids,[1,ids.length]),
      attention_mask:new Tensor("int64",new BigInt64Array(end).fill(1n),[1,end]),
      position_ids:new Tensor("int64",ids.map((_,i)=>BigInt(position+i)),[1,ids.length]),
      logits_to_keep:new Tensor("int64",[1n],[1]),
      past_key_values:cache,
    });
    const next:Record<string,Tensor>={};
    for(const [key,value] of Object.entries(result)) {
      if(key.startsWith("present_conv."))next[key.replace("present_conv.","past_conv.")]=value;
      else if(key.startsWith("present."))next[key.replace("present.","past_key_values.")]=value;
    }
    cache.update(next);
    logits?.dispose();logits=result.logits;
    position=end;
  };
  try {
    for(let start=0;start<prompt.length;start+=256) {
      if(options.stopped())return {tokens,truncated:false};
      await step(prompt.slice(start,start+256));
      options.progress?.("reading",Math.min(start+256,prompt.length));
    }
    for(let i=0;i<options.maxTokens;i++) {
      if(options.stopped())return {tokens,truncated:false};
      const scores=logits!.to("float32");
      const values=scores.data as Float32Array;
      const size=scores.dims.at(-1)!;
      const offset=values.length-size;
      let best=0,bestValue=-Infinity;
      const repeated=new Set(tokens.map(Number));
      for(let t=0;t<size;t++) {
        let value=values[offset+t];
        if(repeated.has(t))value=value<0?value*1.1:value/1.1;
        if(value>bestValue){best=t;bestValue=value;}
      }
      if(scores!==logits)scores.dispose();
      if(best===options.eos)return {tokens,truncated:false};
      tokens.push(BigInt(best));
      if(i%16===0)options.progress?.("writing",tokens.length);
      if(i+1<options.maxTokens)await step([BigInt(best)]);
    }
    return {tokens,truncated:true};
  } finally {logits?.dispose();await cache.dispose();}
}
