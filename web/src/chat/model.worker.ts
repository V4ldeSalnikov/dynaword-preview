import { AutoModelForCausalLM, AutoTokenizer, env, InterruptableStoppingCriteria } from "@huggingface/transformers";
import { MODEL_ID, MODEL_REVISION, plannerRequest } from "./data";

env.allowLocalModels = false;
env.backends.onnx.wasm!.numThreads = 1;
let tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null;
let model: Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>> | null = null;
let busy = false;
const stopping = new InterruptableStoppingCriteria();
const send = (data: unknown) => self.postMessage(data);

self.addEventListener("message", async ({data}) => {
  if(data.type === "stop") { stopping.interrupt(); return; }
  if(busy) return;
  busy=true;
  try {
    if(data.type === "load") {
      const gpu=(navigator as unknown as {gpu?:{requestAdapter:()=>Promise<{features:Set<string>}|null>}}).gpu;
      const adapter=await gpu?.requestAdapter();
      if(!adapter) throw Error("This browser could not access WebGPU. Try a current Chrome or Edge on your Mac, with graphics acceleration enabled.");
      if(!adapter.features.has("shader-f16")) throw Error("This small model needs 16-bit WebGPU support. Try a current Chrome or Edge on your Mac.");
      const progress_callback=(p: any)=>send({type:"progress",status:p.status,file:p.file,loaded:p.loaded,total:p.total,progress:p.progress});
      tokenizer=await AutoTokenizer.from_pretrained(MODEL_ID,{revision:MODEL_REVISION,progress_callback});
      model=await AutoModelForCausalLM.from_pretrained(MODEL_ID,{revision:MODEL_REVISION,device:"webgpu",dtype:"q4f16",progress_callback});
      send({type:"ready"});
    } else if(data.type === "ask") {
      if(!model || !tokenizer) throw Error("Load the local model first.");
      stopping.reset();
      const messages=[{role:"system",content:data.system},...(data.previous ? [{role:"user",content:data.previous.question},{role:"assistant",content:JSON.stringify(plannerRequest(data.previous.plan))}] : []),{role:"user",content:data.question}];
      const inputs=tokenizer.apply_chat_template(messages,{add_generation_prompt:true,return_dict:true});
      const output=await model.generate({...inputs,max_new_tokens:220,do_sample:false,stopping_criteria:[stopping]});
      const sequences=output as unknown as {slice:(...indices:unknown[])=>unknown};
      const generated=sequences.slice(null,[(inputs as any).input_ids.dims[1],null]);
      const text=tokenizer.batch_decode(generated as any,{skip_special_tokens:true})[0];
      send({type:"answer",id:data.id,output:text});
    }
  } catch(error) {
    send({type:"error",id:data.id,message:error instanceof Error?error.message:String(error)});
  } finally {busy=false;}
});
